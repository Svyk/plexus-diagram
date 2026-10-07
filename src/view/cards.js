// Item shells (card / text / section), static content, LOD, culling, idle-chunked mounting,
// and edit mode (spec 3.2). Roam content only ever comes from host.renderString /
// renderBlock / renderPage. The PDF cover is the one <img>: a page image the integrator
// already cached. Nothing here fetches the file or writes the graph.

import { placeNearAnchor } from "./avoid.js";
import { createRowScheduler, isHeavyRow, mountFpsFromStamps } from "./progressive.js";
import { DEFAULT_SIZES, FONT_SIZES, PALETTE, attrNameOf, classifyString, cssColor, firstLine, hexColor, isUntitledBoard, parseBoardTitle, plainText } from "../model/schema.js";
import { isQueryString } from "../model/query.js";
import { dueChip, isTaskString, taskAttrId, taskMeta, taskNamesSig } from "../model/tasks.js";
import { commentCount } from "../model/section6.js";
import { LINKED_REF_CAP, linkedRefCard, linkedRefLabel } from "../model/refs.js";
import { boardPreview, descendantsOf, sectionNoteUid } from "../model/board.js";
import { CARD_MIME } from "./panel.js";
import { lodForZoom, rectsIntersect } from "../model/geometry.js";
import { SHAPES, shapePath } from "../model/shapes.js";
import { fillFromTags, highlighterTags } from "../model/highlighter.js";
import { highlightNote } from "../model/highlight.js";
import { paletteEntries, paletteVars, statusApi, statusLook, statusPalette } from "../model/status-tags.js";
import { openStatusChooser } from "./task-popover.js";
import { nudgeEditorMenus, registerEditorMenus } from "./editor-menus.js";
import { applyEditorCounterScale } from "./editor-scale.js";
import { UNMOUNT_GRACE_MS, intrinsicSize, shellOffscreen, unmountDue } from "./offscreen.js";
import { isStructuralString, parseRegion } from "../model/regions.js";
import { regionRefModel } from "../model/region-card.js";
import { imageRegionRows, regionBadge } from "../model/region-menu.js";
import { renderRegionCard, thumbRequest } from "./region-card.js";
import { copyDrawingPixels, renderDrawingCard } from "./drawing-card.js";
import { clampPdfCard, coverModel, coverOuterBox, embedSplit, pdfMacroUrl, readerRule, writeReaderPage } from "../model/pdf.js";
import { paintPdfChipStrip } from "./pdf-chip-strip.js";
import { guardCallback } from "../guard.js";
import { notedSpeedFlags, parseSpeedFlags, SETTING_IDS } from "../settings.js";
import { authorBlockUid, buildSourceChip, chipWithAuthor, sourceChipFor, sourceChipKey } from "../model/source-chip.js";
import { isRoamTableString } from "../model/roam-table.js";
import { mountRoamTable, syncTableZoom } from "./table-card.js";

const SIDES = ["top", "right", "bottom", "left"];
const CHUNK_MS = 8;
const LRU_CAP = 80;
const UNMOUNT_AFTER_MS = UNMOUNT_GRACE_MS;
const HYDRATE_CAP_MS = 900;
const CONTENT_LIMIT = 12;
const CONTENT_DEPTH = 2;
const OUTLINE_CAP = 300;
const OUTLINE_FETCH = 2000;
const PAGE_WATCH_MAX = 8;
const PAGE_REFRESH_MS = 250;
const BLOCK_REFRESH_MS = 250;
const GROW_CAP = 900;
const HEADER_H = 32;
const META_H = 28;
const REF_TITLE_MAX = 120;
const HEADER_TEXT_MAX = 160;
const TINY_MINI_PX = 28;
const ATTR_CHIPS_MAX = 3;
const SVG_NS = "http://www.w3.org/2000/svg";
const ROW_BOARD_W = 220;
const ROW_BOARD_H = 90;
const ROW_BOARD_THUMBS = 4;
const BOARD_KEY_DEPTH = 3;
const BOARD_KEY_NODES = 400;
const KID_ROW_H = 22;
const PEEK_DELAY_MS = 400;
const PEEK_TOP = 12;
const PEEK_SUB = 4;
const PEEK_TEXT_MAX = 140;

const now = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());

// Names the colour highlighter publishes as --cl-lh-* / --cl-dk-*. pxd-hl is set only when one of them is non-empty.
const HL_NAMES = ["red", "orange", "yellow", "green", "blue", "purple", "pink", "gray", "grey", "teal", "indigo"];

function bodyStyleOf(doc) {
  const view = doc?.defaultView || globalThis;
  const body = doc?.body;
  if (!body || typeof view?.getComputedStyle !== "function") return null;
  try { return view.getComputedStyle(body); } catch { return null; }
}

function hlValue(style, name) {
  if (!style || typeof style.getPropertyValue !== "function") return "";
  const value = style.getPropertyValue(name);
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export function syncBoardHighlighter(doc, root) {
  if (!root?.classList) return false;
  const style = bodyStyleOf(doc);
  let on = false;
  if (style) {
    for (const name of HL_NAMES) {
      if (hlValue(style, `--cl-lh-${name}`) || hlValue(style, `--cl-dk-${name}`)) { on = true; break; }
    }
  }
  root.classList.toggle("pxd-hl", on);
  return on;
}

// probe(name) reads the light or dark highlighter variable, picked from the board root.
function hlProbe(style, dark) {
  return (key) => {
    const raw = String(key || "");
    const name = raw.replace(/^--cl-(?:lh|dk)-/, "").toLowerCase();
    if (!/^[a-z0-9_]+$/.test(name)) return "";
    const chosen = `${dark ? "--cl-dk-" : "--cl-lh-"}${name}`;
    if (raw.startsWith("--cl-") && raw !== chosen) return "";
    return hlValue(style, chosen);
  };
}

export function isTextEntryTarget(target) {
  if (!target || typeof target !== "object") return false;
  const tag = String(target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (target.isContentEditable) return true;
  if (typeof target.getAttribute === "function" && target.getAttribute("contenteditable") === "true") return true;
  if (typeof target.closest !== "function") return false;
  // Not ".rm-block__input": the board is mounted inside the diagram block's own view-mode div of that class,
  // so an ancestor match would make every key on the board look like typing. Roam's editor is a textarea
  // (caught above). An ancestor that contains the board is a host wrapper, not an input.
  const hit = target.closest("[contenteditable=\"true\"], .pxd-label--editing, .pxd-section__title--editing, .pxd-input");
  return Boolean(hit && !hit.querySelector?.(".pxd-root"));
}

// A plain wheel over a page card body scrolls that body until it reaches an end. Cmd/Ctrl+wheel (a pinch) is the board's.
export function pageBodyWantsWheel(target, event) {
  if (!target || typeof target.closest !== "function" || !event) return null;
  if (event.ctrlKey || event.metaKey) return null;
  const dy = Number(event.deltaY) || 0;
  if (!dy) return null;
  const list = target.closest(".pxd-drawing-region-list.is-open");
  if (list && scrollRoom(list, dy)) return list;
  const body = target.closest(".pxd-item__body");
  const card = body?.closest(".pxd-item--page");
  if (!card || card.classList?.contains("pxd-item--editing")) return null;
  return scrollRoom(body, dy) ? body : null;
}

function scrollRoom(el, dy) {
  const room = (Number(el.scrollHeight) || 0) - (Number(el.clientHeight) || 0);
  if (room <= 1) return false;
  const top = Number(el.scrollTop) || 0;
  if (dy > 0 ? top >= room - 1 : top <= 0) return false;
  return true;
}

function synthesizeBlockClick(host) {
  if (!host?.dispatchEvent) return false;
  const rect = host.getBoundingClientRect?.() || { left: 0, top: 0, height: 0 };
  const init = {
    bubbles: true,
    cancelable: true,
    composed: true,
    button: 0,
    buttons: 1,
    detail: 1,
    clientX: (Number(rect.left) || 0) + 2,
    clientY: (Number(rect.top) || 0) + ((Number(rect.height) || 0) / 2),
  };
  for (const type of ["mousedown", "mouseup", "click"]) {
    const Ctor = globalThis.MouseEvent || globalThis.Event;
    const event = typeof Ctor === "function" ? new Ctor(type, init) : { type, ...init };
    host.dispatchEvent(event);
  }
  return true;
}

export function focusRoamInput(el) {
  if (!el) return false;
  try { el.focus?.({ preventScroll: true }); } catch { try { el.focus?.(); } catch { /* unfocused */ } }
  synthesizeBlockClick(el);
  return true;
}

// PGE-2. Offsets are screen px from getBoundingClientRect (body top to the row, then to the input).
// scrollTop is world px. A page editor is not counter-scaled, so a screen delta is divided by the board zoom.
export function pageEditScrollTop(scrollTop, inputOffset, rowOffset, zoom) {
  const base = Number(scrollTop);
  const top = Number.isFinite(base) ? base : 0;
  const row = Number(rowOffset);
  const input = Number(inputOffset);
  if (!Number.isFinite(row) || !Number.isFinite(input)) return Math.max(0, top);
  const delta = input - row;
  if (!delta) return Math.max(0, top);
  const z = Number(zoom);
  const scale = z > 0 && Number.isFinite(z) ? z : 1;
  return Math.max(0, top + delta / scale);
}

// U2. The caret is taken from the rest-state row, before renderPage replaces it.
// Fold and more controls are not part of the block string.
function pageCaretText(node) {
  if (!node || node.nodeType !== 3) return "";
  return String(node.nodeValue ?? node.textContent ?? "");
}

function pageCaretChrome(node) {
  let el = node?.nodeType === 1 ? node : node?.parentElement;
  while (el && el.nodeType === 1) {
    if (el.classList?.contains("pxd-row__fold") || el.classList?.contains("pxd-row__more") || el.classList?.contains("pxd-grip") || el.classList?.contains("pxd-port")) return true;
    if (el.hasAttribute?.("data-pxd-row")) return false;
    el = el.parentElement;
  }
  return false;
}

function pageCaretSize(node) {
  if (!node || pageCaretChrome(node)) return 0;
  if (node.nodeType === 3) return pageCaretText(node).length;
  const kids = node.childNodes ? Array.from(node.childNodes) : [];
  if (kids.length) {
    let n = 0;
    for (const kid of kids) n += pageCaretSize(kid);
    return n;
  }
  return node.nodeType === 1 ? String(node.textContent ?? "").length : 0;
}

function pageCaretOffset(root, node, offset) {
  const index = Math.max(0, Number(offset) || 0);
  if (!root || !node) return 0;
  if (node !== root && typeof root.contains === "function" && !root.contains(node)) return 0;
  let count = 0;
  const visit = (current) => {
    if (!current || pageCaretChrome(current)) return false;
    if (current === node) {
      if (current.nodeType === 3) {
        count += Math.min(index, pageCaretText(current).length);
        return true;
      }
      const kids = current.childNodes ? Array.from(current.childNodes) : [];
      if (kids.length) {
        const n = Math.min(index, kids.length);
        for (let i = 0; i < n; i += 1) count += pageCaretSize(kids[i]);
      } else {
        count += Math.min(index, String(current.textContent ?? "").length);
      }
      return true;
    }
    if (current.nodeType === 3) {
      count += pageCaretText(current).length;
      return false;
    }
    const kids = current.childNodes ? Array.from(current.childNodes) : [];
    for (const kid of kids) if (visit(kid)) return true;
    return false;
  };
  visit(root);
  return count;
}

function pageCaretRow(node) {
  const el = node?.nodeType === 1 ? node : node?.parentElement;
  if (!el) return null;
  if (el.matches?.("[data-pxd-row]")) return el;
  return el.closest?.("[data-pxd-row]") || null;
}

function caretHit(doc, x, y) {
  const px = Number(x);
  const py = Number(y);
  if (!doc || !Number.isFinite(px) || !Number.isFinite(py)) return null;
  let hit = null;
  try {
    if (typeof doc.caretPositionFromPoint === "function") {
      const pos = doc.caretPositionFromPoint(px, py);
      if (pos?.offsetNode) hit = { node: pos.offsetNode, offset: pos.offset };
    }
  } catch { /* point */ }
  if (!hit?.node) {
    try {
      if (typeof doc.caretRangeFromPoint === "function") {
        const range = doc.caretRangeFromPoint(px, py);
        if (range?.startContainer) hit = { node: range.startContainer, offset: range.startOffset };
      }
    } catch { /* range */ }
  }
  return hit?.node ? hit : null;
}

export function pageCaretAtPoint(doc, x, y) {
  const hit = caretHit(doc, x, y);
  if (!hit) return null;
  const rowEl = pageCaretRow(hit.node);
  const row = rowEl?.getAttribute?.("data-pxd-row") || "";
  if (!row) return null;
  return { row, offset: pageCaretOffset(rowEl, hit.node, hit.offset) };
}

// G1. A note or block card has one string, not a page row. The checkbox, grips and
// ports are not characters. task is true when the rendered title already dropped {{[[TODO]]}}.
const NOTE_CARET_SKIP = ".pxd-item__editor, .pxd-task-check, .pxd-grip, .pxd-port, .pxd-row__fold, .pxd-row__more";

export function noteCaretAtPoint(doc, x, y) {
  const hit = caretHit(doc, x, y);
  if (!hit) return null;
  const el = hit.node.nodeType === 1 ? hit.node : hit.node.parentElement;
  if (!el || el.closest?.(NOTE_CARET_SKIP)) return null;
  const root = el.closest?.(".pxd-item__string") || el.closest?.(".pxd-rs");
  if (!root || root.closest?.(NOTE_CARET_SKIP)) return null;
  const card = root.closest?.("[data-uid]");
  return {
    uid: card?.getAttribute?.("data-uid") || "",
    offset: pageCaretOffset(root, hit.node, hit.offset),
    task: Boolean(root.classList?.contains("pxd-item__tasktext")),
  };
}

// Window id is the segment of block-input-<window>-body-... on an input inside this card.
// A wrong window id focuses the outline copy of the same block and Roam clears the embed.
export function pageEditWindowId(editor) {
  if (!editor?.querySelectorAll) return "";
  const prefix = "block-input-";
  for (const node of editor.querySelectorAll(".rm-block__input, textarea, [id^='block-input-']")) {
    const id = String(node.id || node.getAttribute?.("id") || "");
    if (!id.startsWith(prefix)) continue;
    const bodyAt = id.indexOf("-body-");
    if (bodyAt > prefix.length) return id.slice(prefix.length, bodyAt);
  }
  const own = editor.getAttribute?.("data-window-id");
  if (own) return String(own);
  const marked = editor.querySelector?.("[data-window-id]")?.getAttribute?.("data-window-id");
  return marked ? String(marked) : "";
}

// The body's used font is the rest size (13px, or 14px on a block-look card, or a custom size).
// Reading the textarea would compound: its font is already the screen size.
function restFontPx(node) {
  if (!node) return 14;
  try {
    const view = node.ownerDocument?.defaultView || globalThis;
    const cs = view?.getComputedStyle?.(node);
    const raw = cs?.fontSize || cs?.getPropertyValue?.("font-size") || "";
    const n = parseFloat(raw);
    if (n > 0 && Number.isFinite(n)) return n;
  } catch { /* computed style */ }
  return 14;
}

// Page edit stays in world px, the same size as the rows it replaces. Note editors keep the counter-scale.
function scaleCardEditor(editor, zoom) {
  if (editor?.classList?.contains("pxd-page-edit")) return false;
  return applyEditorCounterScale(editor, zoom, restFontPx(editor?.parentElement), true);
}

function nextFrame() {
  return new Promise((resolve) => {
    const raf = globalThis.requestAnimationFrame;
    if (typeof raf === "function") raf(() => resolve());
    else setTimeout(resolve, 16);
  });
}

export async function waitHydrateQuiet(el, capMs = HYDRATE_CAP_MS) {
  const MO = globalThis.MutationObserver;
  if (!el || typeof MO !== "function") {
    await nextFrame();
    await nextFrame();
    return;
  }
  let mutations = 0;
  const observer = new MO(() => { mutations += 1; });
  try { observer.observe(el, { childList: true, subtree: true, attributes: true, characterData: true }); } catch { /* stub */ }
  const start = Date.now();
  const grace = 250;
  let quiet = 0;
  let saw = false;
  try {
    while (Date.now() - start < capMs) {
      if (!saw && Date.now() - start >= grace) break;
      await nextFrame();
      if (mutations > 0) { saw = true; quiet = 0; } else if (saw) quiet += 1;
      mutations = 0;
      if (saw && quiet >= 2) break;
    }
  } finally {
    observer.disconnect();
  }
}

const childString = (c) => c?.[":block/string"] ?? c?.string ?? "";
const childKids = (c) => c?.[":block/children"] ?? c?.children ?? [];
const childUid = (c) => c?.[":block/uid"] ?? c?.uid ?? "";

const childProps = (c) => c?.[":block/props"] ?? c?.props;

const KIDS_KINDS = ["note", "block"];
const isKidsCard = (item) => item?.type === "card" && KIDS_KINDS.includes(item.kind);
// EK-2: a sticky is a text item with the sticky look. Its body is the live Roam block, so the string is not part
// of the content key while the live editor owns it.
const isSticky = (item) => item?.type === "text" && item.look === "sticky" && !item.shape;
const STICKY_TITLE_MAX = 40;
const stickyTitleOf = (string) => {
  const line = plainText(firstLine(String(string || ""))).trim();
  return line ? line.slice(0, STICKY_TITLE_MAX) : "Note";
};
// Direct children that count as rows. Better Tasks attribute children are chips, never rows, bullets or badge counts.
const isTaskAttrString = (s) => taskAttrId(s) !== null;
const skipChildString = (s) => isTaskAttrString(s) || isStructuralString(s);
const visibleKids = (list) => (list || []).filter((c) => !skipChildString(childString(c)));
// A note card whose block is a task, with Better Tasks loaded, draws a light Plexus checkbox (a span, not an input, so
// it is not one of Better Tasks' 100 decorated checkboxes) and renders the rest of the title with the marker cut off.
// A click on that checkbox completes through Better Tasks' own checkbox path (src/view/task-complete.js), so the
// Completed date and the next occurrence still happen. Without Better Tasks the card flips the marker itself.
let taskBlockOn = () => false;
// TSK-3. Changes with the Task Status Tags list, so a rename or recolour repaints task cards.
let statusSig = "";
const TASK_MARK = /^\s*\{\{\[\[(?:TODO|DONE)\]\]\}\}\s?/;
const isTaskCard = (item) => item?.type === "card" && item.kind === "note" && isTaskString(item.string);
// Rows renderBlocks will draw for this list (same depth and row caps).
function kidRowsOf(list, depth = 1, budget = { n: 0 }) {
  for (const c of visibleKids(list)) {
    if (budget.n >= CONTENT_LIMIT) break;
    budget.n += 1;
    const kids = childKids(c);
    if (kids.length && depth < CONTENT_DEPTH) kidRowsOf(kids, depth + 1, budget);
  }
  return budget.n;
}

function cardContentKey(item, live = false, pdfOpen = false, chipSig = "", coverSig = "") {
  if (isSticky(item)) {
    return ["sticky", live ? "live" : item.string, item.min ? "m" : "", item.fontSize || "", item.textColor || "", item.align || ""].join("\u0001");
  }
  const parts = [
    item.kind, item.enhanced ? "e" : "", item.string, item.collapsed ? "c" : "", item.open === false ? "x" : "", item.kids ? "k" : "",
    item.fontSize || "", item.textColor || "", item.align || "", item.fill || "", item.border || "",
    item.titleSize || "", item.titleColor || "", item.titleFill || "", item.areaFill || "",
    taskBlockOn(item) ? `tb${taskNamesSig()}${statusSig}` : "",
    item.kind === "pdf" ? (pdfOpen ? "o" : "") : (pdfOpen ? "h" : ""),
    item.kind === "pdf" && chipSig ? chipSig : "",
    item.kind === "pdf" && coverSig ? coverSig : "",
    item.kind === "highlight" && item.highlight ? item.highlight.color ?? "" : "",
    item.kind === "highlight" && item.highlight ? item.highlight.page ?? "" : "",
    item.kind === "highlight" && item.highlight ? item.highlight.text ?? "" : "",
    item.kind === "highlight" && item.highlight?.image === true ? "img" : "",
    item.kind === "highlight" && item.highlight?.natural ? `${item.highlight.natural.w}x${item.highlight.natural.h}` : "",
    item.kind === "highlight" && item.highlight ? item.highlight.note ?? "" : "",
  ];
  if (item.kind === "board") parts.push(item.w, item.h);
  if (item.kind === "board") {
    // The mini preview draws the child board's layout, so a layout-only change inside it must refresh the card.
    let budget = BOARD_KEY_NODES;
    const walkBoard = (kids, depth) => {
      if (depth > BOARD_KEY_DEPTH) return;
      for (const c of kids) {
        if (budget-- <= 0) return;
        parts.push(childUid(c), childString(c), JSON.stringify(childProps(c) ?? null));
        walkBoard(childKids(c), depth + 1);
      }
    };
    walkBoard(item.content || [], 1);
    return parts.join("\u0001");
  }
  const walk = (kids, depth) => {
    if (depth > CONTENT_DEPTH) return;
    for (const c of kids) { parts.push(childString(c)); walk(childKids(c), depth + 1); }
  };
  walk(item.content || [], 1);
  return parts.join("\u0001");
}

// One ready/unload pair per window. Disconnected renderers are dropped when either event fires.
const regionHubs = new WeakMap();

function regionHub(win) {
  if (!win || (typeof win !== "object" && typeof win !== "function")) return null;
  let hub = regionHubs.get(win);
  if (hub) return hub;
  hub = { win, entries: new Set(), listening: false };
  const detach = () => {
    if (!hub.listening) return;
    try { win.removeEventListener?.("roam-plexus:ready", hub.onReady); } catch { /* already gone */ }
    try { win.removeEventListener?.("roam-plexus:unload", hub.onUnload); } catch { /* already gone */ }
    hub.listening = false;
  };
  const prune = () => {
    for (const entry of [...hub.entries]) {
      if (entry.root?.isConnected !== false) continue;
      hub.entries.delete(entry);
      try { entry.release?.(); } catch { /* already gone */ }
    }
    if (!hub.entries.size) detach();
  };
  const fan = (key) => {
    prune();
    for (const entry of hub.entries) {
      try { entry[key]?.(); } catch { /* one renderer */ }
    }
  };
  hub.onReady = () => fan("onReady");
  hub.onUnload = () => fan("onUnload");
  hub.attach = () => {
    if (hub.listening) return;
    win.addEventListener?.("roam-plexus:ready", hub.onReady);
    win.addEventListener?.("roam-plexus:unload", hub.onUnload);
    hub.listening = true;
  };
  regionHubs.set(win, hub);
  return hub;
}

function joinRegionHub(win, entry) {
  const hub = regionHub(win);
  if (!hub) return () => {};
  hub.entries.add(entry);
  hub.attach();
  let left = false;
  return () => {
    if (left) return;
    left = true;
    hub.entries.delete(entry);
    if (!hub.entries.size) {
      try { win.removeEventListener?.("roam-plexus:ready", hub.onReady); } catch { /* already gone */ }
      try { win.removeEventListener?.("roam-plexus:unload", hub.onUnload); } catch { /* already gone */ }
      hub.listening = false;
    }
  };
}

// Static stand-in for a video, iframe, or tweet. The live node mounts only for the one open uid.
export function paintEmbedPoster(doc, parent, model, onOpen) {
  const node = doc.createElement("div");
  node.className = "pxd-embed-poster";
  const uid = String(model?.uid || "");
  if (uid) node.setAttribute("data-pxd-embed", uid);
  if (model?.kind) node.setAttribute("data-kind", String(model.kind));
  const title = doc.createElement("div");
  title.className = "pxd-embed-poster__title";
  title.textContent = String(model?.title || "Embed");
  node.append(title);
  const label = typeof model?.label === "string" ? model.label.trim() : "";
  if (label) {
    const count = doc.createElement("div");
    count.className = "pxd-embed-poster__count";
    count.textContent = label;
    node.append(count);
  }
  const thumb = typeof model?.thumb === "string" ? model.thumb : "";
  if ((thumb.startsWith("data:image/") || thumb.startsWith("blob:")) && !/["'()]/.test(thumb)) {
    node.style.backgroundImage = `url("${thumb}")`;
  }
  const open = doc.createElement("button");
  open.type = "button";
  open.className = "pxd-embed-open pxd-chrome";
  open.textContent = "Open";
  const stop = (event) => event.stopPropagation();
  const onClick = (event) => {
    stop(event);
    if (typeof event.preventDefault === "function") event.preventDefault();
    if (uid) onOpen?.(uid);
  };
  for (const type of ["pointerdown", "mousedown", "dblclick"]) open.addEventListener(type, stop);
  open.addEventListener("click", onClick);
  node._pxdPosterOff = () => {
    for (const type of ["pointerdown", "mousedown", "dblclick"]) open.removeEventListener(type, stop);
    open.removeEventListener("click", onClick);
    node._pxdPosterOff = null;
  };
  node.append(open);
  parent?.append?.(node);
  return node;
}

export function dropEmbedPoster(node) {
  try { node?._pxdPosterOff?.(); } catch { /* already off */ }
  const nested = node?.querySelectorAll?.(".pxd-embed-poster") || [];
  for (const child of nested) {
    try { child._pxdPosterOff?.(); } catch { /* already off */ }
  }
}

// loading | none | error | ready. A ready face with no src is none: there is nothing to decode.
function coverFace(image) {
  if (!image || typeof image !== "object") return "none";
  const state = image.state;
  if (state === "loading" || state === "error" || state === "none") return state;
  if (state === "ready") return typeof image.src === "string" && image.src ? "ready" : "none";
  return typeof image.src === "string" && image.src ? "ready" : "none";
}

function coverSigOf(image) {
  const state = coverFace(image);
  const src = typeof image?.src === "string" ? image.src : "";
  const last = image?.lastPage ?? "";
  const ticks = Array.isArray(image?.ticks)
    ? image.ticks.map((tick) => `${tick?.y01 ?? ""}:${tick?.color || ""}:${tick?.page ?? ""}`).join(",")
    : "";
  return [state, src, last, ticks].join("|");
}

function tickY01(tick) {
  const y = Number(tick?.y01);
  if (!Number.isFinite(y)) return 0;
  if (y < 0) return 0;
  if (y > 1) return 1;
  return y;
}

function tickPage(tick) {
  const n = Number(tick?.page);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

// The page title sits after the first " · " in the stored footer ("p. 3 · Title").
function highlightChipTitle(footer) {
  const text = typeof footer === "string" ? footer.trim() : "";
  const mark = text.indexOf(" · ");
  let title = mark >= 0 ? text.slice(mark + 3).trim() : "";
  if (!title && text && !/^p\. \d+/.test(text)) title = text;
  return title.length > 24 ? title.slice(0, 24) : title;
}

function highlightChipPage(hl) {
  const page = hl?.page;
  if (typeof page === "number" && Number.isFinite(page)) return `p. ${page}`;
  if (typeof page === "string" && page.trim()) return `p. ${page.trim()}`;
  const footer = typeof hl?.footer === "string" ? hl.footer.trim() : "";
  const match = /^p\. \d+/.exec(footer);
  return match ? match[0] : "";
}

// Same outline as the pane glyph. 28 px on the empty cover, 16 px in the source chip.
function paintPdfGlyph(doc, parent, px) {
  const ns = "http://www.w3.org/2000/svg";
  const size = String(px);
  if (typeof doc?.createElementNS === "function") {
    const svg = doc.createElementNS(ns, "svg");
    svg.setAttribute("class", "pxd-pdf-glyph");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", size);
    svg.setAttribute("height", size);
    svg.setAttribute("aria-hidden", "true");
    const path = doc.createElementNS(ns, "path");
    path.setAttribute("d", "M3.5 1.5h6L13 5v9.5H3.5v-13zM9.5 1.8V5H13");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.2");
    svg.append(path);
    parent?.append?.(svg);
    return svg;
  }
  const span = doc.createElement("span");
  span.className = "pxd-pdf-glyph";
  span.setAttribute("aria-hidden", "true");
  parent?.append?.(span);
  return span;
}

function releaseBlob(url) {
  if (typeof url !== "string" || !url.startsWith("blob:")) return;
  try { globalThis.URL?.revokeObjectURL?.(url); } catch { /* already gone */ }
}

export function createItemRenderer({
  doc = globalThis.document,
  host,
  session,
  itemsLayer,
  sectionsLayer,
  timers,
  onGrow,
  onRenameCommit,
  onEditChange,
  onEditResize,
  onOpenBoard,
  onRenameBoard,
  onRenamePage,
  onBadgeClick,
  onPageLayout,
  onTaskChip,
  onToast,
  bt = null,
  pdfChips = null,
  onPdfPulse = null,
  onPdfOpen = null,
  onEmbedOpen = null,
  onReadPane = null,
  onHighlightOpen = null,
  onHighlightNote = null,
  coverImage = null,
  pdfMetaTitle = null,
  onPdfOpenRequest = null,
  onHighlightHover = null,
  onHighlightMenu = null,
  readingUid = null,
  settings: speedSettings = null,
  interopOn = null,
} = {}) {
  // Production reads the hidden setting. A test passes `settings` and does not open the panel.
  const speedOf = () => {
    if (speedSettings == null) return notedSpeedFlags();
    if (Object.prototype.hasOwnProperty.call(speedSettings, SETTING_IDS.speedFlags)) {
      return parseSpeedFlags(speedSettings[SETTING_IDS.speedFlags]);
    }
    return parseSpeedFlags(speedSettings);
  };
  taskBlockOn = (item) => Boolean(bt?.available?.()) && isTaskCard(item);
  let pdfOpenUid = null;
  let pdfLiveUid = null;
  // P32-5: the one PDF card that shows Roam's reader inside the card. Only the menu sets it.
  let inlineUid = null;
  let pdfLiveOff = null;
  let paneForce = null;
  let panePage = null;
  let paneHl = null;
  let openingEmbed = false;
  let selectedPrimary = null;
  let openEmbed = () => {};
  let closeEmbed = () => {};
  let ownsOpen = () => false;
  let ownHeavyUid = () => null;
  // Chip rows cost a page read per highlight. One turn on one board shares them; the next turn reads again.
  let chipMemo = null;
  const chipsFor = (item) => {
    if (item?.kind !== "pdf" || typeof pdfChips !== "function") return [];
    if (!chipMemo || chipMemo.board !== lastBoard) {
      const memo = { board: lastBoard, rows: new Map() };
      chipMemo = memo;
      queueMicrotask(() => { if (chipMemo === memo) chipMemo = null; });
    }
    const hit = chipMemo.rows.get(item.uid);
    if (hit) return hit;
    let rows = [];
    try {
      const got = pdfChips(item);
      rows = Array.isArray(got) ? got : [];
    } catch {
      rows = [];
    }
    chipMemo.rows.set(item.uid, rows);
    return rows;
  };
  const chipHandlers = (item) => ({
    later: (fn, ms) => (typeof timers?.later === "function" ? timers.later(fn, ms) : setTimeout(fn, ms)),
    onPulse: (uids) => { try { onPdfPulse?.(uids); } catch { /* host */ } },
    onOpen: (page) => { try { onPdfOpen?.(item.uid, page); } catch { /* host */ } },
  });
  const interopAllowed = () => {
    if (typeof interopOn !== "function") return true;
    try { return interopOn() !== false; } catch { return true; }
  };
  // One pull of a reading page's children per sync. The next sync sees an author rename.
  let sourcePass = 0;
  let pageKids = new Map();
  const sourceKids = (raw) => {
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === "object") return raw[":block/children"] || raw.children || [];
    return [];
  };
  const pageChildrenOf = (pageUid) => {
    if (!pageUid) return [];
    if (pageKids.has(pageUid)) return pageKids.get(pageUid);
    let raw = null;
    try { raw = host?.pullTree?.(pageUid, 1, 80); } catch { raw = null; }
    if (raw && typeof raw.then === "function") {
      const pass = sourcePass;
      pageKids.set(pageUid, []);
      raw.then((value) => {
        if (pass !== sourcePass) return;
        pageKids.set(pageUid, sourceKids(value));
      }).catch(() => {});
      return [];
    }
    const kids = sourceKids(raw);
    pageKids.set(pageUid, kids);
    return kids;
  };
  const sourceChipOf = (item) => {
    if (item?.kind !== "block") return null;
    const ref = item.target?.uid;
    if (!ref) return null;
    let refString = "";
    try { refString = host?.blockString?.(ref) || ""; } catch { refString = ""; }
    if (refString) {
      if (classifyString(refString).kind === "board") return null;
      if (isQueryString(refString)) return null;
    }
    let title = "";
    try { title = host?.pageTitleOf?.(ref) || ""; } catch { title = ""; }
    const text = typeof title === "string" ? title.trim() : "";
    if (!text.startsWith("Articles/") && !text.startsWith("Media Captures/")) return null;
    let pageUid = "";
    try { pageUid = host?.pageUid?.(text) || ""; } catch { pageUid = ""; }
    return sourceChipFor({ pageTitle: text, pageUid, pageChildren: pageChildrenOf(pageUid) });
  };
  const readingUidOf = () => {
    if (typeof readingUid !== "function") return "";
    try {
      const id = readingUid();
      return typeof id === "string" ? id : "";
    } catch {
      return "";
    }
  };
  const contentKeyFor = (item, live = false) => {
    let key = cardContentKey(
      item,
      live,
      item?.kind === "pdf" ? (onReadPane ? false : pdfOpenUid === item.uid) : ownsOpen(item),
      item?.kind === "pdf" ? chipsFor(item).map((chip) => `${chip.page}:${chip.count}`).join(",") : "",
      item?.kind === "pdf" ? coverSigOf(coverImageOf(item)) : "",
    );
    if (item?.kind === "block") {
      const sig = sourceChipKey(sourceChipOf(item));
      if (sig) key += `\u0001${sig}`;
    }
    if ((item?.kind === "drawing-ref" || item?.kind === "region-ref") && !interopAllowed()) key += "\u0001interop-off";
    return key;
  };
  const shells = new Map(); // uid → rec
  const mounted = new Map(); // uid → lastWanted (LRU order = insertion order)
  // ED-2: per-item board renders, on the same object as window.__plexusDiagram.stats.
  const noteRender = (uid) => {
    const bag = host?.stats;
    if (!bag || typeof bag !== "object") return;
    if (!bag.items || typeof bag.items !== "object") bag.items = {};
    bag.items[uid] = (Number(bag.items[uid]) || 0) + 1;
  };
  let lod = "detail";
  let focusSet = null;
  let badgeMap = new Map();
  let showBadges = false;
  let trailBadgeMap = new Map();
  let taskChips = "full";
  let zoomCache = 1;
  // U2. Pointerdown on a page row, while the rest outline is still there. enterEdit reads it.
  let pagePointer = null;
  const PAGE_CARET_MS = 1000;
  const PAGE_CLICK_PX = 5;
  let paused = false;
  let editing = null;
  let contentSched = null;
  let frameSample = null;
  const frameStamps = [];
  let wanted = new Set();
  let lastBoard = null;
  let lastRects = null;
  let focusGuard = null;
  let floorTeardown = null;
  let floor = null; // { start, cancel } while a focus recovery is pending
  let floorRetry = null; // cancel handle for the re-arm scheduled when the recovery cap refused a floor
  let recoveries = [];
  let lastOutsideDown = -Infinity;
  let disposed = false;
  let trackPopover = false;
  let unregisterMenus = () => {};
  let leaveRegionHub = () => {};

  // `.rm-block__input` is also the read-only block view. The caret lives on the textarea.
  // Idle renderers return before any query. The search stays inside this board's root.
  const menuRoot = itemsLayer?.closest?.(".pxd-root") || sectionsLayer?.closest?.(".pxd-root") || null;
  const menuAnchor = () => {
    if (disposed) return null;
    if (!editing && !trackPopover) return null;
    if (!editing) {
      const pop = menuRoot?.querySelector?.(".bp3-popover-open") || null;
      if (!pop) { trackPopover = false; return null; }
      return pop;
    }
    const fromEditor = editing.editor?.querySelector?.("textarea") || editing.editor?.querySelector?.(".rm-block__input");
    if (fromEditor) return fromEditor;
    if (!menuRoot?.querySelector) return null;
    return menuRoot.querySelector(".pxd-item--editing textarea")
      || menuRoot.querySelector(".bp3-popover-open")
      || null;
  };
  unregisterMenus = registerEditorMenus(doc, {
    root: menuRoot || itemsLayer || { isConnected: true },
    anchor: menuAnchor,
  });

  const later = (fn, ms) => (timers?.later ? timers.later(fn, ms) : (() => { const t = setTimeout(fn, ms); return () => clearTimeout(t); })());
  const idle = (fn, soon = false) => {
    if (timers?.idle) return timers.idle(fn);
    // A busy Roam can starve idle callbacks for hundreds of ms. Visible page rows ask for a plain task instead:
    // one 8 ms slice, then it yields again.
    if (soon) { const t = setTimeout(() => fn({ timeRemaining: () => CHUNK_MS, didTimeout: true }), 0); return () => clearTimeout(t); }
    const ric = globalThis.requestIdleCallback;
    if (typeof ric === "function") { const id = ric(fn); return () => globalThis.cancelIdleCallback?.(id); }
    const t = setTimeout(() => fn({ timeRemaining: () => CHUNK_MS, didTimeout: true }), 0);
    return () => clearTimeout(t);
  };

  const el = (tag, cls, parent) => {
    const node = doc.createElement(tag);
    node.className = cls;
    parent?.append(node);
    return node;
  };

  // Iframes and PDF highlights sit in the Roam root. A shield beside that root takes the hit so pan and drag still see the card.
  const EMBED_SEL = "iframe, video, .rm-pdf-highlight, .rm-pdf-container, .twitter-tweet, .rm-xparser-default-tweet";
  const embedLive = (node) => {
    for (const child of node.children || []) if (child.classList?.contains("pxd-rs__live")) return child;
    return node;
  };
  // A board item uses its own w/h. A page-row embed has no item and uses the reader box.
  const embedBoxFor = (uid) => {
    const item = uid ? lastBoard?.items.get(uid) : null;
    if (item && (Number(item.w) > 0 || Number(item.h) > 0)) return coverOuterBox({ w: item.w, h: item.h });
    return coverOuterBox({});
  };
  const fitEmbedOuter = (node, box) => {
    if (!node?.style || !box) return;
    node.style.width = `${box.w}px`;
    node.style.height = `${box.h}px`;
    node.style.boxSizing = "border-box";
    node.style.overflow = "hidden";
  };
  const holdHeight = (node, px) => {
    if (!node?.style || !(px > 0) || node.style.minHeight) return;
    node.style.minHeight = `${Math.round(px)}px`;
  };
  // Shell height only. Edit mode owns minHeight on the card element.
  const reserveCardHeight = (rec, item) => {
    const h = Number(item?.h);
    if (!rec?.el?.style || !(h > 0) || rec.el.style.height) return;
    rec.el.style.height = `${Math.round(h)}px`;
  };
  const armEmbedShield = (node, live) => {
    if (node?.classList?.contains("pxd-embed-live") && !node.style?.height) {
      fitEmbedOuter(node, embedBoxFor(node.getAttribute?.("data-pxd-embed")));
    }
    const syncShield = () => {
      const hit = live.querySelector?.(EMBED_SEL);
      let shield = null;
      for (const child of node.children || []) if (child.classList?.contains("pxd-embed-shield")) shield = child;
      if (hit && !shield) {
        const cover = el("div", "pxd-embed-shield", node);
        cover.setAttribute("aria-hidden", "true");
      } else if (!hit && shield) shield.remove();
    };
    syncShield();
    const MO = doc.defaultView?.MutationObserver || globalThis.MutationObserver;
    if (typeof MO !== "function") return;
    const mo = new MO(guardCallback("embed-shield", () => syncShield()));
    try { mo.observe(live, { childList: true, subtree: true }); } catch { return; }
    node.__pxdEmbedMo = mo;
  };

  const embedOptsFor = (uid) => ({
    uid,
    read: (id) => {
      const item = lastBoard?.items.get(id);
      if (typeof item?.string === "string" && item.string.trim()) return item.string;
      try {
        const text = host?.blockString?.(id);
        return typeof text === "string" ? text : "";
      } catch { return ""; }
    },
    cover: (source) => {
      try { return host?.pdfCover?.(source) ?? null; } catch { return null; }
    },
  });
  const heavyMounts = (item) => {
    if (!item || item.kind === "highlight") return [];
    if (item.kind === "pdf") return [{ uid: item.uid, kind: "pdf", title: "" }];
    const out = [];
    const pushString = (string, id) => {
      if (typeof string !== "string" || !string.trim()) return;
      const split = embedSplit(string, embedOptsFor(id || item.uid));
      for (const poster of split.posters) out.push({ ...poster, uid: poster.uid || id || item.uid });
    };
    if (item.kind === "block" && item.target?.uid) {
      let text = "";
      try { text = host?.blockString?.(item.target.uid) || ""; } catch { text = ""; }
      pushString(text, item.target.uid);
    } else pushString(item.string || "", item.uid);
    const walk = (list, depth) => {
      if (!Array.isArray(list) || depth > CONTENT_DEPTH) return;
      for (const child of list) {
        pushString(childString(child), childUid(child) || item.uid);
        walk(childKids(child), depth + 1);
      }
    };
    if (item.kind !== "page") walk(item.content, 1);
    return out;
  };
  const posterTitleOf = (item) => {
    if (!item || item.kind === "pdf" || item.kind === "highlight") return "";
    return heavyMounts(item)[0]?.title || "";
  };
  ownHeavyUid = (item) => {
    if (!item || item.collapsed || item.type === "section") return null;
    if (item.kind === "highlight" || item.kind === "image" || item.kind === "board" || item.kind === "region-ref" || item.kind === "drawing-ref") return null;
    if (item.kind === "pdf") return item.uid;
    return heavyMounts(item)[0]?.uid || null;
  };
  const paintLiveEmbed = (node, string, liveUid) => {
    node.classList.add("pxd-embed-live");
    if (liveUid) node.setAttribute("data-pxd-embed", liveUid);
    const box = embedBoxFor(liveUid);
    fitEmbedOuter(node, box);
    const live = el("div", "pxd-rs__live", node);
    fitEmbedOuter(live, box);
    let mountedLive = false;
    if (liveUid && host?.renderBlock) {
      try { host.renderBlock(live, liveUid); mountedLive = true; } catch { mountedLive = false; }
    }
    if (!mountedLive) {
      try { live.replaceChildren?.(); } catch { /* stub */ }
      try {
        if (host?.renderString) host.renderString(live, string);
        else live.textContent = plainText(string);
      } catch { live.textContent = plainText(string); }
    }
    armEmbedShield(node, live);
  };

  const mountQuery = (parent, uid) => {
    const live = el("div", "pxd-rs pxd-item__query", parent);
    const mount = el("div", "pxd-rs__live", live);
    try { host.renderBlock(mount, uid); }
    catch { mount.textContent = "Query"; }
    return live;
  };

  // TSK-3. Status colours and glyphs come from Task Status Tags when it is loaded, a fixed table otherwise.
  let statusPal = null;
  const statusWin = () => doc?.defaultView || globalThis;
  const palette = () => statusPal || (statusPal = statusPalette(statusApi(statusWin())));
  const statusTheme = () => (boardRoot()?.classList?.contains("pxd-root--dark") ? "dark" : "light");
  const applyStatusVars = (node, status) => {
    if (!node?.style) return;
    if (!status) {
      node.style.removeProperty?.("--pxd-status-base");
      node.style.removeProperty?.("--pxd-status-text");
      return;
    }
    const vars = paletteVars(statusLook(status, palette()), statusTheme()) || {};
    for (const [key, value] of Object.entries(vars)) node.style.setProperty?.(key, value);
  };
  const taskUidOf = (item) => (item?.target?.kind === "block" && item.target.uid ? item.target.uid : item?.uid);
  // TSK-4. Writes go through Task Status Tags only; the card re-renders from the pull-watch echo.
  const setTaskStatus = async (uid, name) => {
    const api = statusApi(statusWin());
    if (!api || !uid) return;
    let result = null;
    try { result = await api.setStatus(uid, name); } catch { result = { status: "unknown", reason: "set-status-failed" }; }
    if (result && result.status !== "updated" && result.status !== "unchanged") {
      try { onToast?.(`Status not changed: ${result.reason || result.status}`); } catch { /* toast */ }
    }
  };
  const mountStatusControl = (line, item, meta) => {
    if (!statusApi(statusWin()) || meta?.done) return;
    const ctl = el("span", "pxd-task-check__status", line);
    ctl.setAttribute("role", "button");
    ctl.setAttribute("tabindex", "0");
    const name = meta?.status || "";
    ctl.setAttribute("aria-label", name ? `Status ${name}. Change status` : "Set a status");
    ctl.title = name ? `Status: ${name}. Click to change, Shift-click to remove.` : "Set a status";
    if (name) ctl.setAttribute("data-status-name", name);
    const uid = taskUidOf(item);
    const open = (event) => {
      stopEvent(event);
      if (event.type !== "click" && !(event.type === "keydown" && (event.key === "Enter" || event.key === " "))) return;
      if (event.shiftKey && name) { void setTaskStatus(uid, null); return; }
      openStatusChooser({
        doc,
        anchor: ctl,
        palette: palette(),
        current: name,
        avoid: boardRoot(),
        onPick: (picked) => { void setTaskStatus(uid, picked); },
        onRemove: () => { void setTaskStatus(uid, null); },
      });
    };
    for (const type of ["pointerdown", "mousedown", "dblclick", "click", "keydown"]) ctl.addEventListener(type, open);
  };

  // RE-5: the checkbox is a span; the title text is the string without its TODO/DONE marker.
  const mountTaskLine = (parent, item) => {
    const meta = taskMeta(item.string, item.content);
    const line = el("div", "pxd-item__taskline", parent);
    mountStatusControl(line, item, meta);
    const box = el("span", `pxd-task-check${meta?.done ? " pxd-task-check--done" : ""}${meta?.cancelled ? " pxd-task-check--cancelled" : ""}`, line);
    if (meta?.status) {
      box.setAttribute("data-status", statusLook(meta.status, palette()).glyph);
      applyStatusVars(box, meta.status);
    }
    box.setAttribute("role", "checkbox");
    box.setAttribute("aria-checked", meta?.done ? "true" : "false");
    box.setAttribute("aria-label", meta?.done ? "Done" : "To do");
    const text = renderRoot(line, String(item.string).replace(TASK_MARK, ""), "pxd-rs pxd-item__string pxd-item__tasktext", item.uid);
    return text;
  };

  const setHidden = (node, hidden) => {
    node.hidden = hidden;
    if (hidden) node.setAttribute("hidden", "");
    else node.removeAttribute("hidden");
  };

  const addRefRow = (list, rec, ref, on) => {
    const payload = linkedRefCard(ref?.uid);
    if (!payload) return;
    const row = el("div", "pxd-refs__row", list);
    row.draggable = true;
    row.setAttribute("draggable", "true");
    row.dataset.uid = ref.uid;
    row.setAttribute("data-uid", ref.uid);
    const liveWrap = el("div", "pxd-rs", row);
    const live = el("div", "pxd-rs__live", liveWrap);
    try {
      if (host?.renderBlock) host.renderBlock(live, ref.uid);
      else live.textContent = String(ref.string || "");
    } catch {
      live.textContent = String(ref.string || "");
    }
    armEmbedShield(liveWrap, live);
    rec.roots.push(liveWrap);
    for (const type of ["pointerdown", "mousedown", "dblclick"]) on(row, type, stopEvent);
    on(row, "dragstart", (event) => {
      event.stopPropagation();
      try {
        event.dataTransfer?.setData?.(CARD_MIME, payload);
        event.dataTransfer?.setData?.("text/plain", payload);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
      } catch { /* the drag still leaves the source block alone */ }
    });
  };

  const mountLinkedRefs = (body, rec, item) => {
    let refs = [];
    try {
      const got = host?.linkedRefs?.(item, { limit: LINKED_REF_CAP });
      if (Array.isArray(got)) refs = got.slice(0, LINKED_REF_CAP);
    } catch { refs = []; }
    const offs = [];
    const on = (node, type, fn) => {
      node.addEventListener(type, fn);
      offs.push(() => node.removeEventListener(type, fn));
    };
    rec.refOff = () => { for (const off of offs.splice(0)) off(); };
    const wrap = el("div", "pxd-refs", body);
    const toggle = el("button", "pxd-refs__toggle", wrap);
    toggle.type = "button";
    toggle.textContent = linkedRefLabel(refs.length);
    toggle.setAttribute("aria-label", toggle.textContent);
    toggle.setAttribute("aria-expanded", "false");
    const list = el("div", "pxd-refs__list", wrap);
    setHidden(list, true);
    for (const type of ["pointerdown", "mousedown", "dblclick"]) on(toggle, type, stopEvent);
    let filled = false;
    on(toggle, "click", (event) => {
      event.stopPropagation();
      event.preventDefault();
      const open = toggle.getAttribute("aria-expanded") !== "true";
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      wrap.classList.toggle("pxd-refs--open", open);
      setHidden(list, !open);
      if (!open || filled) return;
      filled = true;
      for (const ref of refs) addRefRow(list, rec, ref, on);
    });
  };

  // One log per uid for the life of this renderer. A later content pass must not log again.
  const loggedRenderErrors = new Set();
  const showRenderChip = (node, uid) => {
    node.classList.add("pxd-item--error");
    const chip = el("div", "pxd-render-chip", node);
    el("span", "pxd-render-chip__label", chip).textContent = "Could not render";
    el("span", "pxd-render-chip__uid", chip).textContent = uid;
    const open = el("button", "pxd-btn pxd-render-chip__open", chip);
    open.type = "button";
    open.textContent = "Open";
    open.setAttribute("aria-label", "Open");
    for (const type of ["pointerdown", "mousedown", "dblclick", "click"]) {
      open.addEventListener(type, (event) => {
        stopEvent(event);
        if (type === "click" && uid) host?.openBlock?.(uid);
      });
    }
  };
  // Roam's renderString catches a broken {{[[roam/render]]}} and writes this phrase instead of throwing.
  const RENDER_FAIL = "Error rendering component";
  const RENDER_FAILS = [RENDER_FAIL, "Failed to render"];
  // PL-2: rows inside cards swap a failed macro for the raw text, muted, instead of a chip or Roam's grey box.
  const showPlainRow = (node, string) => {
    node.classList.add("pxd-rs--plain");
    el("span", "pxd-rs__plain", node).textContent = String(string ?? "");
  };
  const renderRoot = (parent, string, cls = "pxd-rs", uid = "", { plain = false } = {}) => {
    const node = el("div", cls, parent);
    if (!string) return node;
    const split = embedSplit(String(string), embedOptsFor(uid));
    if (split.posters.length && speedOf().posters === false) {
      paintLiveEmbed(node, string, split.posters[0].uid || uid);
      return node;
    }
    if (split.posters.length) {
      const hit = pdfOpenUid ? split.posters.find((poster) => (poster.uid || uid) === pdfOpenUid) : null;
      if (hit && lod === "detail") {
        paintLiveEmbed(node, string, hit.uid || uid);
        return node;
      }
      if (split.rest) {
        const rest = el("div", "pxd-embed-rest", node);
        rest.textContent = plainText(split.rest);
      }
      for (const poster of split.posters) {
        const mount = poster.uid || uid;
        const painted = paintEmbedPoster(doc, node, { ...poster, uid: mount }, (id) => openEmbed(id || mount));
        fitEmbedOuter(painted, embedBoxFor(mount));
      }
      return node;
    }
    const live = el("div", "pxd-rs__live", node);
    const buffered = [];
    const origError = console.error;
    console.error = (...args) => { buffered.push(args); };
    let thrown = null;
    try {
      if (host?.renderString) host.renderString(live, string);
      else live.textContent = plainText(string);
    } catch (error) {
      thrown = error;
    } finally {
      console.error = origError;
    }
    const renderedText = String(live.textContent || "");
    const failed = Boolean(thrown) || RENDER_FAILS.some((t) => renderedText.includes(t))
      || Boolean(live.querySelector?.(".rm-render-failed, .rm-api-render--failed"));
    if (!failed) {
      for (const args of buffered) origError.apply(console, args);
      armEmbedShield(node, live);
      return node;
    }
    try { host?.unmount?.(live); } catch { /* Roam had nothing to detach */ }
    try { live.remove(); } catch { /* already gone */ }
    if (plain) showPlainRow(node, string);
    else showRenderChip(node, uid);
    if (!loggedRenderErrors.has(uid)) {
      loggedRenderErrors.add(uid);
      const reported = thrown || buffered[0]?.[0] || new Error(renderedText.slice(0, 180));
      origError.call(console, reported);
    }
    return node;
  };

  const unmountRoots = (rec) => {
    try { rec.regionNode?.pxdUnmount?.(); } catch { /* already revoked */ }
    rec.regionNode = null;
    try { rec.drawingNode?.pxdUnmount?.(); } catch { /* already revoked */ }
    rec.drawingNode = null;
    rec.drawingToken = null;
    try { rec.refOff?.(); } catch { /* already off */ }
    rec.refOff = null;
    try { rec.pageUnwatch?.(); } catch { /* already off */ }
    rec.pageUnwatch = null;
    try { rec.blockUnwatch?.(); } catch { /* already off */ }
    rec.blockUnwatch = null;
    try { rec.authorUnwatch?.(); } catch { /* already off */ }
    rec.authorUnwatch = null;
    rec.blockStringNode = null;
    rec.pageRoots = [];
    rec.pageHolder = null;
    rec.rowState = null;
    stopRowSched(rec);
    dropLayoutWatch(rec);
    rec.scrollOff?.();
    rec.scrollOff = null;
    try { rec.pdfCoverOff?.(); } catch { /* already off */ }
    rec.pdfCoverOff = null;
    try { rec.hlHoverOff?.(); } catch { /* already off */ }
    rec.hlHoverOff = null;
    rec.pdfReader = null;
    if (!rec.roots?.length) return;
    for (const node of rec.roots) {
      const live = node.querySelector?.(".pxd-rs__live");
      if (!live && !node.classList?.contains("pxd-embed-live")) continue;
      try { node.__pxdEmbedMo?.disconnect(); } catch { /* already gone */ }
      try { host?.unmount?.(live || embedLive(node)); } catch { /* not a roam root */ }
    }
    rec.roots = [];
  };

  // PL-1: a row whose block is a {{[[diagram]]}} board (or an embed of one) cannot render through renderString.
  // It becomes a compact board row: a mini-map thumbnail, or a chip when the thumbnail budget is spent or the board
  // is the one on screen. PL-2: any other row that fails to render falls back to its raw text.
  let rowThumbs = ROW_BOARD_THUMBS;
  const startRows = () => { rowThumbs = ROW_BOARD_THUMBS; };
  const EMBED_RE = /^\{\{\s*(?:\[\[)?embed(?:\]\])?\s*:\s*\(\(([\w-]+)\)\)\s*\}\}$/i;
  const boardRowTarget = (uid, string) => {
    const t = String(string ?? "").trim();
    if (classifyString(t).kind === "board") return { uid, string: t };
    const m = EMBED_RE.exec(t);
    if (!m) return null;
    const inner = host?.blockString?.(m[1]);
    return typeof inner === "string" && classifyString(inner).kind === "board" ? { uid: m[1], string: inner } : null;
  };
  const mountBoardRow = (parent, cls, target) => {
    const node = el("div", `${cls} pxd-rs--board`, parent);
    const title = parseBoardTitle(target.string) || "Untitled board";
    const self = target.uid === lastBoard?.uid;
    const open = (event) => {
      stopEvent(event);
      if (event.shiftKey) host?.openInSidebar?.(target.uid, "block");
      else openBoard(target.uid);
    };
    const raw = self ? null : host?.pullBoard?.(target.uid);
    const content = raw?.[":block/children"] ?? raw?.children ?? [];
    if (self || !raw || rowThumbs <= 0) {
      const chip = el("button", "pxd-btn pxd-board-row pxd-board-row--chip", node);
      chip.type = "button";
      const n = self ? 0 : boardPreview({ uid: target.uid, string: target.string, content }).count;
      const label = self ? "this board" : `${n} ${n === 1 ? "item" : "items"}`;
      chip.textContent = `\u25A6 ${title} \u00B7 ${label}`;
      chip.dataset.action = "open";
      chip.setAttribute("aria-label", `Open board ${title}`);
      for (const type of ["pointerdown", "mousedown", "dblclick"]) chip.addEventListener(type, stopEvent);
      chip.addEventListener("click", open);
      return node;
    }
    rowThumbs -= 1;
    const wrap = el("div", "pxd-board-row", node);
    mountBoardBody(wrap, {
      uid: target.uid,
      string: target.string,
      content,
      w: ROW_BOARD_W + 24,
      h: ROW_BOARD_H + HEADER_H + META_H,
      title,
      enhanced: false,
    }, { openUid: target.uid });
    wrap.addEventListener("click", (event) => {
      if (!event.shiftKey || event.target?.closest?.("button")) return;
      open(event);
    });
    return node;
  };
  const mountTableHost = (parent, uid, budget) => {
    const node = mountRoamTable(doc, parent, {
      uid,
      zoom: zoomCache,
      renderBlock: typeof host?.renderBlock === "function" ? (el, id) => host.renderBlock(el, id) : null,
      unmount: (el) => { try { host?.unmount?.(el); } catch { /* not a roam root */ } },
      portalParent: boardRoot(),
    });
    if (budget) budget.roots.push(node);
    return node;
  };
  const renderRowRoot = (parent, string, cls, uid) => {
    if (isRoamTableString(string)) {
      const node = mountTableHost(parent, uid);
      for (const name of String(cls || "").split(/\s+/)) if (name) node.classList.add(name);
      return node;
    }
    const target = boardRowTarget(uid, string);
    return target ? mountBoardRow(parent, cls, target) : renderRoot(parent, string, cls, uid, { plain: true });
  };

  // ---------------------------------------------------------------- shells
  const buildPorts = (parent) => {
    const wrap = el("div", "pxd-ports", parent);
    for (const side of SIDES) {
      const p = el("div", `pxd-port pxd-port--${side}`, wrap);
      p.dataset.side = side;
      p.setAttribute("data-side", side);
      p.title = "Drag to connect";
    }
    return wrap;
  };
  const buildGrips = (parent) => {
    for (const part of ["right", "bottom", "corner"]) {
      const g = el("div", `pxd-grip pxd-grip--${part}`, parent);
      g.dataset.part = part;
      g.setAttribute("data-part", part);
    }
  };

  const buildShell = (item) => {
    const rec = { uid: item.uid, type: item.type, roots: [], contentKey: null, rect: null, bare: item.type === "card" };
    if (item.type === "section") {
      const node = el("div", "pxd-section", null);
      rec.el = node;
      rec.title = el("div", "pxd-section__title", node);
      rec.note = el("div", "pxd-section__note", node);
      for (const side of ["t", "r", "b", "l"]) el("div", `pxd-section__edge pxd-section__edge--${side}`, node);
      buildGrips(node);
      buildPorts(node);
    } else {
      const node = el("div", `pxd-item pxd-item--${item.type}`, null);
      rec.el = node;
      rec.header = el("div", "pxd-item__header", node);
      rec.body = el("div", "pxd-item__body", node);
      buildPorts(node);
      buildGrips(node);
      if (item.kind === "page") armPageCaret(rec);
    }
    rec.el.dataset.uid = item.uid;
    rec.el.setAttribute("data-uid", item.uid);
    rec.el.setAttribute("role", "group");
    rec.el.tabIndex = -1;
    rec.tabStop = -1;
    const onShellFocus = (event) => {
      if (disposed || editing?.uid === rec.uid) return;
      const target = event.target;
      if (target?.closest?.(".pxd-item__editor")) return;
      const poster = target?.closest?.(".pxd-embed-poster");
      if (poster && rec.el.contains?.(poster)) {
        const id = poster.getAttribute("data-pxd-embed");
        if (id) openEmbed(id);
        return;
      }
      // A click focuses the cover after select. With a side pane, that must not open the reader.
      // Without a pane, the cover focus still mounts the inline reader (the only reader there is).
      if (target?.closest?.(".pxd-pdf-cover") && rec.el.contains?.(target)) {
        if (typeof onReadPane !== "function") openEmbed(rec.uid);
        return;
      }
      if (target === rec.el) {
        const heavy = ownHeavyUid(lastBoard?.items.get(rec.uid));
        if (heavy) openEmbed(heavy, { implicit: true });
      }
    };
    rec.el.addEventListener("focusin", onShellFocus);
    rec.focusOff = () => {
      rec.el.removeEventListener("focusin", onShellFocus);
      rec.focusOff = null;
    };
    shells.set(item.uid, rec);
    return rec;
  };

  const setVar = (el, name, value) => {
    if (value) el.style.setProperty(name, value);
    else el.style.removeProperty(name);
  };
  const boardRoot = () => itemsLayer?.closest?.(".pxd-root") || sectionsLayer?.closest?.(".pxd-root") || null;
  const paintTagChip = (rec, info) => {
    if (!info) {
      if (rec.tagChip) { rec.tagChip.remove(); rec.tagChip = null; }
      return;
    }
    if (!rec.tagChip || !rec.tagChip.isConnected) rec.tagChip = el("span", "pxd-hl-chip", rec.el);
    let swatch = rec.tagChip.querySelector?.(".pxd-hl-swatch");
    if (!swatch) swatch = el("span", "pxd-hl-swatch", rec.tagChip);
    swatch.style.setProperty("background", info.color);
    swatch.style.setProperty("display", "inline-block");
    swatch.style.setProperty("width", "10px");
    swatch.style.setProperty("height", "10px");
    swatch.setAttribute("aria-hidden", "true");
    let name = rec.tagChip.querySelector?.(".pxd-hl-name");
    if (!name) name = el("span", "pxd-hl-name", rec.tagChip);
    if (name.textContent !== info.name) name.textContent = info.name;
    rec.tagChip.setAttribute("data-tag", info.name);
  };
  // Props fill wins and does not call fillFromTags. A tag fill probes --cl-lh-* or --cl-dk-* on document.body.
  const tagFillOf = (item) => {
    if (!item || item.type === "section" || cssColor(item.fill, "fill")) return null;
    const tags = highlighterTags(typeof item.string === "string" ? item.string : "");
    if (!tags.bg) return null;
    const dark = Boolean(boardRoot()?.classList?.contains("pxd-root--dark"));
    const color = fillFromTags(tags, hlProbe(bodyStyleOf(doc), dark));
    return color ? { name: tags.bg, color } : null;
  };
  // Inline variables only when a key is present, so a 1.2 board with no style keys keeps its look.
  const applyStyle = (rec, item) => {
    const node = rec.el;
    if (item.type === "section") {
      const d = item.sectionDefaults || {};
      const area = item.areaFill ?? d.areaFill;
      const border = item.border ?? d.border;
      const titleSize = item.titleSize ?? d.titleSize;
      const titleColor = item.titleColor ?? d.titleColor;
      const titleFill = item.titleFill ?? d.titleFill;
      setVar(node, "--pxd-fill", cssColor(area, "fill"));
      setVar(node, "--pxd-line", cssColor(border, "line") || hexColor(item.color) || "");
      if (rec.title) {
        rec.title.style.fontSize = titleSize ? `${titleSize}px` : "";
        rec.title.style.color = cssColor(titleColor, "text") || "";
        rec.title.style.background = cssColor(titleFill, "fill") || "";
      }
      return;
    }
    const accent = hexColor(item.color);
    const propsFill = cssColor(item.fill, "fill") || "";
    const tagFill = propsFill ? null : tagFillOf(item);
    setVar(node, "--pxd-card-fs", item.fontSize ? `${item.fontSize}px` : "");
    setVar(node, "--pxd-text-fs", item.type === "text" && item.fontSize ? `${item.fontSize}px` : "");
    setVar(node, "--pxd-text-c", cssColor(item.textColor, "text") || accent || "");
    setVar(node, "--pxd-fill", propsFill || tagFill?.color || accent || "");
    setVar(node, "--pxd-line", cssColor(item.border, "line") || accent || "");
    node.style.textAlign = item.align || "";
    const stickyHex = item.type === "text" && item.look === "sticky" && !item.shape
      ? (hexColor(item.fill) || accent || "")
      : "";
    node.style.backgroundColor = stickyHex;
    paintTagChip(rec, tagFill);
  };

  const syncShape = (rec, item, size) => {
    const name = item?.type === "text" && SHAPES.includes(item.shape) ? item.shape : "";
    if (!name) {
      if (rec.shapeEl) { rec.shapeEl.remove(); rec.shapeEl = null; rec.shapePath = null; }
      rec.shapeName = "";
      rec.shapeKey = "";
      return;
    }
    if (!rec.shapeEl) {
      const svg = doc.createElementNS(SVG_NS, "svg");
      svg.setAttribute("class", "pxd-shape");
      svg.setAttribute("aria-hidden", "true");
      const path = doc.createElementNS(SVG_NS, "path");
      svg.append(path);
      const before = rec.body || null;
      if (before) rec.el.insertBefore(svg, before);
      else rec.el.append(svg);
      rec.shapeEl = svg;
      rec.shapePath = path;
    }
    const w = size?.w ?? item.w;
    const h = size?.h ?? item.h;
    const key = `${name}:${w}:${h}`;
    rec.shapeName = name;
    if (rec.shapeKey === key) return;
    rec.shapeEl.setAttribute("viewBox", `0 0 ${w} ${h}`);
    rec.shapePath.setAttribute("d", shapePath({ x: 0, y: 0, w, h }, name));
    rec.shapeKey = key;
  };

  // EK-2: the sticky header is a drag bar with a short title, a colour dot and a minimize toggle. Built once per shell.
  const stickyBtn = (parent, cls, tip, label) => {
    const b = el("button", cls, parent);
    b.type = "button";
    b.setAttribute("data-tip", tip);
    b.setAttribute("aria-label", label);
    // A press on a header control must not start a drag or change the selection.
    for (const type of ["pointerdown", "mousedown", "dblclick"]) b.addEventListener(type, stopEvent);
    return b;
  };
  const buildStickyHeader = (rec) => {
    rec.header.textContent = "";
    const title = el("span", "pxd-sticky__title", rec.header);
    const swatches = el("span", "pxd-sticky__swatches", rec.header);
    swatches.hidden = true;
    for (const color of PALETTE) {
      const sw = stickyBtn(swatches, `pxd-swatch pxd-sticky__swatch pxd-c-${color}`, "sticky.swatch", color);
      sw.setAttribute("data-color", color);
      sw.addEventListener("click", (event) => {
        event.stopPropagation();
        setStickyPicking(rec, false);
        void session?.setColor?.([rec.uid], color);
      });
    }
    const dot = stickyBtn(rec.header, "pxd-sticky__btn pxd-sticky__dot", "sticky.color", "Sticky color");
    dot.addEventListener("click", (event) => {
      event.stopPropagation();
      setStickyPicking(rec, Boolean(rec.stickyBits?.swatches.hidden));
    });
    const min = stickyBtn(rec.header, "pxd-sticky__btn pxd-sticky__min", "sticky.min", "Minimize sticky");
    min.addEventListener("click", (event) => {
      event.stopPropagation();
      const item = lastBoard?.items.get(rec.uid);
      if (item) void session?.setMinimized?.(rec.uid, !item.min);
    });
    rec.stickyBits = { title, swatches, dot, min };
  };
  const setStickyPicking = (rec, on) => {
    if (!rec.stickyBits) return;
    rec.stickyBits.swatches.hidden = !on;
    rec.stickyBits.title.hidden = on;
    rec.el.classList.toggle("pxd-sticky--picking", on);
  };
  const paintStickyHeader = (rec, item) => {
    if (!rec.stickyBits) buildStickyHeader(rec);
    const { title, min } = rec.stickyBits;
    title.textContent = stickyTitleOf(item.string);
    min.setAttribute("aria-label", item.min ? "Expand sticky" : "Minimize sticky");
    min.setAttribute("data-tip", item.min ? "sticky.expand" : "sticky.min");
    min.textContent = item.min ? "+" : "\u2212";
    rec.header.style.display = "";
    rec.header.setAttribute("data-tip", "sticky.drag");
  };
  const dropStickyHeader = (rec) => {
    rec.header.removeAttribute("data-tip");
    rec.header.textContent = "";
    rec.stickyBits = null;
    rec.el.classList.remove("pxd-sticky--picking");
  };

  const TRANSIENT_CLASSES = ["pxd-item--offscreen", "pxd-item--future", "pxd-item--fresh", "pxd-item--pulse", "pxd-item--flash"];
  const imageRegionString = (text) => {
    const region = parseRegion(text);
    return Boolean(region && region.kind === "img" && region.supported === true && region.owner === "plexus-diagram" && region.error == null);
  };

  const paintShell = (rec, item) => {
    const node = rec.el;
    if (item.type !== "section") {
      // A block-ref card's title lives in the referenced block; resolve it here so map LOD and collapsed cards keep a header.
      rec.refString = null;
      rec.refBoard = false;
      rec.regionImg = false;
      if (item.kind === "block" && item.target?.uid) {
        const refString = host?.blockString?.(item.target.uid);
        if (typeof refString === "string") {
          rec.refString = refString;
          rec.refBoard = classifyString(refString).kind === "board";
          rec.regionImg = imageRegionString(refString);
        }
        if (rec.refBoard) rec.refTitle = parseBoardTitle(rec.refString) || "Untitled board";
        else rec.refTitle = typeof refString === "string" ? firstLine(refString).slice(0, REF_TITLE_MAX) : "";
      } else rec.refTitle = "";
    }
    const base = item.type === "section" ? "pxd-section" : `pxd-item pxd-item--${item.type} pxd-item--${item.kind}`;
    const cls = [base];
    if (PALETTE.includes(item.color)) cls.push(`pxd-c-${item.color}`);
    if (item.collapsed && item.type !== "section") cls.push("pxd-item--collapsed");
    if (item.type === "section" && item.collapsed) cls.push("pxd-section--collapsed");
    if (item.type === "section" && item.look === "lane") cls.push("pxd-section--lane", item.axis === "vertical" ? "pxd-lane-v" : "pxd-lane-h");
    if (!item.string?.trim()) cls.push("pxd-item--empty");
    if (item.type === "text" && FONT_SIZES.includes(item.fontSize)) cls.push(`pxd-item--fs${item.fontSize}`);
    if (item.type !== "section" && item.fontSize) cls.push("pxd-fs");
    if (item.textColor) cls.push("pxd-has-textc");
    if (item.type === "text" && item.shape) cls.push("pxd-item--shape", `pxd-item--shape-${item.shape}`);
    else if (isSticky(item)) cls.push("pxd-item--sticky");
    else if (item.type === "text" && (item.fill || item.border)) cls.push("pxd-text-paint");
    if (rec.selected) cls.push(item.type === "section" ? "pxd-section--selected" : "pxd-item--selected");
    if (rec.hover) cls.push("pxd-item--drop");
    if (editing?.uid === item.uid) cls.push(editing.sticky ? "pxd-item--typing" : "pxd-item--editing");
    if (isSticky(item) && item.min) cls.push("pxd-item--min");
    if (item.pinned) cls.push(item.type === "section" ? "pxd-section--pinned" : "pxd-item--pinned");
    if (item.landmark) {
      cls.push(item.type === "section" ? "pxd-section--landmark" : "pxd-item--landmark");
      cls.push(`pxd-landmark--${item.size === "S" || item.size === "L" ? item.size : "M"}`);
    }
    if (focusSet && !focusSet.has(item.uid)) cls.push(item.type === "section" ? "pxd-section--focus-dim" : "pxd-item--focus-dim");
    if (item.type !== "section") {
      if (isKidsCard(item)) cls.push(item.kids ? "pxd-item--kids" : "pxd-item--kidsoff");
      if (rec.bare) cls.push("pxd-item--bare");
      if (rec.refBoard) cls.push("pxd-item--wb");
      if (rec.regionImg) cls.push("pxd-item--imgregion");
      if (item.kind === "region-ref") cls.push("pxd-item--region");
      if (item.kind === "drawing-ref") cls.push("pxd-item--drawing");
      if (item.kind === "pdf" && pdfLiveUid === item.uid) cls.push("pxd-pdf-live");
      if (item.kind === "pdf" && readingUidOf() === item.uid) cls.push("pxd-item--reading");
      if (item.kind === "highlight" && item.highlight?.image === true) cls.push("pxd-item--image");
      if (item.look === "block") cls.push("pxd-card--block");
      const task = isTaskCard(item) ? taskMeta(item.string, item.content) : null;
      applyStatusVars(node, task?.status || "");
      if (task) {
        cls.push("pxd-item--task");
        if (task.done) cls.push("pxd-item--task-done");
        if (task.cancelled) cls.push("pxd-item--task-cancelled");
        if (task.due?.today && !task.done) cls.push("pxd-item--task-today");
        if (task.due?.overdue) cls.push("pxd-item--overdue", "pxd-item--task-overdue");
      } else if (item.type === "card" && dueChip(item.content)?.overdue) cls.push("pxd-item--overdue");
    }
    // Classes other code toggles on the shell (offscreen shell, memory lane, pulse) survive the re-sync.
    for (const keep of TRANSIENT_CLASSES) if (node.classList?.contains(keep)) cls.push(keep);
    node.className = cls.join(" ");
    {
      const dueShort = item.type === "card" && cls.includes("pxd-item--task") ? taskMeta(item.string, item.content)?.due?.short : "";
      // The map tier prints it after the header text, and a pseudo element reads its own element's attribute.
      if (rec.header) {
        if (dueShort) rec.header.setAttribute("data-task-due", dueShort);
        else rec.header.removeAttribute("data-task-due");
      }
    }
    applyStyle(rec, item);
    if (item.type !== "section") syncShape(rec, item);
    if (item.type === "section") {
      if (!rec.titleRendered || rec.titleString !== item.string) {
        rec.title.textContent = item.title || "Section";
        rec.titleString = item.string;
        rec.titleRendered = false;
      }
      const noteUid = !item.collapsed && lastBoard ? sectionNoteUid(lastBoard, item.uid) : null;
      const note = noteUid ? lastBoard.items.get(noteUid) : null;
      if (rec.note) {
        if (note) {
          rec.note.style.display = "";
          rec.note.textContent = firstLine(note.string || "");
        } else rec.note.style.display = "none";
      }
    } else {
      if (isSticky(item)) paintStickyHeader(rec, item);
      else {
        if (rec.stickyBits) dropStickyHeader(rec);
        if (editing?.uid !== item.uid && !rec.renaming) rec.header.textContent = item.type === "text" ? "" : String(rec.refTitle || item.title || "").slice(0, HEADER_TEXT_MAX);
        if (item.kind === "pdf" && editing?.uid !== item.uid && !rec.renaming) {
          const cover = pdfCoverOf(item);
          rec.pdfCover = cover;
          rec.header.textContent = String(cover.title || "PDF").slice(0, HEADER_TEXT_MAX);
        }
        if (item.kind === "highlight" && item.highlight && editing?.uid !== item.uid && !rec.renaming) {
          rec.header.textContent = firstLine(item.highlight.text || "").slice(0, HEADER_TEXT_MAX);
        }
        const posterTitle = posterTitleOf(item);
        if (posterTitle && editing?.uid !== item.uid && !rec.renaming) {
          rec.header.textContent = posterTitle.slice(0, HEADER_TEXT_MAX);
        }
        if (item.type === "text") rec.header.style.display = "none";
      }
      rec.header.classList.toggle("pxd-item__header--muted", item.kind === "board" && isUntitledBoard(item.title));
    }
    node.title = "";
    const announced = item.type === "section" ? (item.title || "Section") : String(rec.refTitle || item.title || "Untitled");
    node.setAttribute("aria-label", `${announced}, ${item.type}`);
    if (item.landmark || rec.landmarkEl) paintLandmarkMark(rec, item);
    if (trailBadgeMap.size || rec.trailBadge) paintTrailBadge(rec, item.uid);
  };

  // Created only for a real landmark or a real badge, so a board with neither adds no nodes.
  const paintLandmarkMark = (rec, item) => {
    if (!item.landmark) {
      if (rec.landmarkEl) { rec.landmarkEl.remove(); rec.landmarkEl = null; }
      return;
    }
    if (!rec.landmarkEl) rec.landmarkEl = el("span", "pxd-landmark", rec.el);
    const text = item.glyph || "";
    if (rec.landmarkEl.textContent !== text) rec.landmarkEl.textContent = text;
  };
  const paintTrailBadge = (rec, uid) => {
    const n = trailBadgeMap.get(uid);
    if (!n) {
      if (rec.trailBadge) { rec.trailBadge.remove(); rec.trailBadge = null; }
      return;
    }
    if (!rec.trailBadge) rec.trailBadge = el("span", "pxd-trail-badge", rec.el);
    const text = String(n);
    if (rec.trailBadge.textContent !== text) rec.trailBadge.textContent = text;
  };

  const shownRect = (uid, rect) => {
    if (!rect) return rect;
    const item = lastBoard?.items.get(uid);
    if (item?.kind !== "pdf") return rect;
    const capped = clampPdfCard(rect);
    if (capped.w === rect.w && capped.h === rect.h) return rect;
    return { ...rect, w: capped.w, h: capped.h };
  };
  const position = (rec, rect) => {
    const prev = rec.rect;
    rec.rect = rect;
    // Same rect while editing: leave the first-frame lock alone. A later rect write must not put it back.
    if (editing?.uid === rec.uid && prev && prev.x === rect.x && prev.y === rect.y && prev.w === rect.w && prev.h === rect.h) return;
    const shown = shownRect(rec.uid, rect);
    rec.el.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
    rec.el.style.width = `${shown.w}px`;
    rec.el.style.height = `${shown.h}px`;
    // Editing pins height !important so height:auto cannot grow the card. A resize rewrites that pin.
    if (editing?.uid === rec.uid && rec.el.classList?.contains("pxd-item--editing") && rec.el.style?.height && rec.el.style.setProperty) {
      rec.el.style.setProperty("height", rec.el.style.height, "important");
    }
    if (rec.shapeName) syncShape(rec, { type: "text", shape: rec.shapeName, w: rect.w, h: rect.h }, rect);
  };

  const removeShell = (uid) => {
    const rec = shells.get(uid);
    if (!rec) return;
    if (pdfLiveUid === uid) endPdfInteract();
    if (pdfOpenUid === uid) pdfOpenUid = null;
    else {
      const gone = lastBoard?.items.get(uid);
      if (gone?.target?.uid && pdfOpenUid === gone.target.uid) pdfOpenUid = null;
      else if (pdfOpenUid && rec.el?.querySelector?.(`[data-pxd-embed="${pdfOpenUid}"]`)) pdfOpenUid = null;
    }
    if (selectedPrimary === uid) selectedPrimary = null;
    if (editing?.uid === uid) void exitEdit({ silent: true });
    try { rec.focusOff?.(); } catch { /* already off */ }
    try { rec.pageCaretOff?.(); } catch { /* already off */ }
    dropEmbedPoster(rec.el);
    unmountRoots(rec);
    rec.el.remove();
    shells.delete(uid);
    mounted.delete(uid);
  };

  // Structural or partial sync from the model.
  let shellQueue = [];
  const placeShells = () => {
    if (typeof doc.createDocumentFragment !== "function") {
      for (const uid of lastBoard?.order || []) {
        const rec = shells.get(uid);
        if (!rec?.el) continue;
        const layer = rec.type === "section" ? sectionsLayer : itemsLayer;
        if (rec.el.parentElement !== layer || layer.lastChild !== rec.el) layer.append(rec.el);
      }
      return;
    }
    const sectionNodes = doc.createDocumentFragment();
    const itemNodes = doc.createDocumentFragment();
    for (const uid of lastBoard?.order || []) {
      const rec = shells.get(uid);
      if (!rec?.el) continue;
      (rec.type === "section" ? sectionNodes : itemNodes).append(rec.el);
    }
    if (sectionNodes.childNodes.length) sectionsLayer.append(sectionNodes);
    if (itemNodes.childNodes.length) itemsLayer.append(itemNodes);
  };
  const pumpShells = () => {
    const chunk = shellQueue.splice(0, 40);
    for (const uid of chunk) {
      const item = lastBoard?.items.get(uid);
      if (!item || shells.has(uid)) continue;
      const rec = buildShell(item);
      const rect = lastRects?.get(uid);
      rec.el.style.display = rect ? "" : "none";
      noteRender(uid);
      paintShell(rec, item);
      if (rect) position(rec, rect);
    }
    if (chunk.length) placeShells();
    // A shell built after the open pass still needs its offscreen size. The next gesture must not be the first paint.
    if (chunk.length && lastContent) paintOffscreen(lastContent.visibleRect);
    if (shellQueue.length && timers?.frame) timers.frame(pumpShells);
  };
  const sync = ({ board, rects, dirty: changed = null, structural = false, view = null }) => {
    sourcePass += 1;
    pageKids = new Map();
    lastBoard = board;
    lastRects = rects;
    // A highlight card placed, removed or changed moves its PDF's page chips and count, though the PDF card itself did not change.
    let dirty = changed;
    if (dirty != null) {
      let touched = structural;
      if (!touched) for (const uid of dirty) if (board.items.get(uid)?.kind === "highlight") { touched = true; break; }
      if (touched) {
        dirty = new Set(dirty);
        for (const [uid, item] of board.items) if (item.kind === "pdf") dirty.add(uid);
      }
    }
    syncBoardHighlighter(doc, boardRoot());
    // A full sync builds every missing shell itself. A partial sync must leave the
    // open-time queue alone, or the cards past the first chunk never appear.
    if (dirty == null) shellQueue = [];
    for (const uid of [...shells.keys()]) if (!board.items.has(uid)) removeShell(uid);
    let orderChanged = structural;
    let defer = null;
    if (!shells.size && board.order.length > 80 && typeof timers?.frame === "function") {
      const now = [];
      const later = [];
      for (const uid of board.order) {
        const rect = rects.get(uid);
        if (view && rect && rectsIntersect(rect, view)) now.push(uid);
        else later.push(uid);
      }
      // A camera over empty space used to build every shell in this frame.
      if (!now.length && view) {
        const cx = view.x + view.w / 2;
        const cy = view.y + view.h / 2;
        const dist = (uid) => {
          const r = rects.get(uid);
          return r ? (r.x + r.w / 2 - cx) ** 2 + (r.y + r.h / 2 - cy) ** 2 : Infinity;
        };
        later.sort((a, b) => dist(a) - dist(b));
      }
      if (!now.length) now.push(...later.splice(0, 24));
      if (now.length && later.length) defer = new Set(later);
    }
    for (const uid of board.order) {
      if (defer?.has(uid)) continue;
      const item = board.items.get(uid);
      let rec = shells.get(uid);
      const fresh = !rec;
      if (!rec) { rec = buildShell(item); orderChanged = true; }
      const rect = rects.get(uid);
      rec.el.style.display = rect ? "" : "none";
      if (fresh || !dirty || dirty.has(uid)) {
        // Roam owns the open editor. A pull-watch echo of its text must not repaint this card or remount it.
        if (!fresh && editing?.uid === uid) {
          if (rect && (!rec.rect || rec.rect.x !== rect.x || rec.rect.y !== rect.y || rec.rect.w !== rect.w || rec.rect.h !== rect.h)) position(rec, rect);
        } else {
          noteRender(uid);
          paintShell(rec, item);
          if (rect) position(rec, rect);
          const key = contentKeyFor(item, rec.stickyLive);
          if (rec.contentKey !== null && rec.contentKey !== key && editing?.uid !== uid) {
            // content changed under a mounted shell → remount on the next content pass
            unmountRoots(rec);
            rec.body?.replaceChildren?.();
            rec.contentKey = null;
            mounted.delete(uid);
            contentSched?.drop(uid);
            rec.titleRendered = false;
            if (rec.type === "card") { rec.bare = true; rec.el.classList.add("pxd-item--bare"); }
          }
          if (showBadges) renderBadges(rec);
        }
      } else if (rect && (!rec.rect || rec.rect.x !== rect.x || rec.rect.y !== rect.y || rec.rect.w !== rect.w || rec.rect.h !== rect.h)) {
        position(rec, rect);
      }
    }
    if (orderChanged) placeShells();
    if (defer?.size) {
      shellQueue = [...defer];
      timers.frame(pumpShells);
    }
  };


  // ---------------------------------------------------------------- CH-1/CH-3: children badge and peek
  let peek = null; // { node, rec, off }
  let peekTimer = null;
  const peekRoot = () => itemsLayer?.closest?.(".pxd-root") || null;
  const closePeek = () => {
    peekTimer?.();
    peekTimer = null;
    if (!peek) return;
    const p = peek;
    peek = null;
    p.off?.();
    try { p.node.remove(); } catch { /* already gone */ }
  };
  const peekRowsOf = (rec, item, done) => {
    const take = (list) => done(visibleKids(list).slice(0, PEEK_TOP));
    if (item.kind === "note") return take(item.content);
    const tree = host?.pullTree?.(item.target.uid, 2, 200);
    if (tree && typeof tree.then === "function") tree.then(take).catch(() => {});
    else take(tree);
  };
  const openPeek = (rec) => {
    peekTimer = null;
    const item = lastBoard?.items.get(rec.uid);
    const root = peekRoot();
    if (disposed || peek || !root || !rec.kidsBtn || !item || !isKidsCard(item) || editing || paused) return;
    peekRowsOf(rec, item, (rows) => {
      if (disposed || peek || !rec.kidsBtn?.isConnected || !rows.length) return;
      const node = el("div", "pxd-kids-peek", root);
      node.setAttribute("role", "tooltip");
      for (const c of rows) {
        el("div", "pxd-kids-peek__row", node).textContent = plainText(childString(c), PEEK_TEXT_MAX);
        for (const g of visibleKids(childKids(c)).slice(0, PEEK_SUB)) {
          el("div", "pxd-kids-peek__row pxd-kids-peek__row--sub", node).textContent = plainText(childString(g), PEEK_TEXT_MAX);
        }
      }
      placeNearAnchor(node, rec.kidsBtn.getBoundingClientRect(), root, { gap: 6 });
      const close = () => closePeek();
      doc.addEventListener?.("pointerdown", close, true);
      doc.addEventListener?.("wheel", close, true);
      peek = { node, rec, off: () => { doc.removeEventListener?.("pointerdown", close, true); doc.removeEventListener?.("wheel", close, true); } };
    });
  };
  const dropKidsBadge = (rec) => {
    if (!rec.kidsBtn) return;
    if (peek?.rec === rec) closePeek();
    for (const off of rec.kidsOffs || []) off();
    rec.kidsOffs = [];
    rec.kidsBtn.remove();
    rec.kidsBtn = null;
  };
  const toggleKids = (uid) => {
    const item = lastBoard?.items.get(uid);
    if (!isKidsCard(item)) return false;
    const rec = shells.get(uid);
    const on = !item.kids;
    const extra = on ? Math.ceil((Number(rec?.kidRows) || 0) * KID_ROW_H + 8) : 0;
    void session?.setKids?.(uid, on, extra);
    return true;
  };
  const syncKidsBadge = (rec, itemArg) => {
    const item = itemArg || lastBoard?.items.get(rec.uid);
    const want = Boolean(item) && isKidsCard(item) && lod === "detail" && editing?.uid !== rec.uid
      && !item.collapsed && !rec.refBoard && !rec.bare && Number(rec.kidCount) > 0;
    if (!want) return dropKidsBadge(rec);
    const text = `${item.kids ? "\u25BE" : "\u25B8"} ${rec.kidCount}`;
    if (!rec.kidsBtn) {
      const btn = el("button", "pxd-kids", rec.el);
      btn.type = "button";
      rec.kidsOffs = [];
      const on = (type, fn) => {
        btn.addEventListener(type, fn);
        rec.kidsOffs.push(() => btn.removeEventListener(type, fn));
      };
      for (const type of ["pointerdown", "mousedown", "dblclick"]) {
        on(type, (event) => { stopEvent(event); peekTimer?.(); peekTimer = null; });
      }
      on("click", (event) => { stopEvent(event); closePeek(); toggleKids(rec.uid); });
      on("mouseenter", (event) => {
        if (event.buttons || peek || peekTimer) return;
        peekTimer = later(() => openPeek(rec), PEEK_DELAY_MS);
      });
      on("mouseleave", () => closePeek());
      rec.kidsBtn = btn;
    }
    rec.kidsBtn.textContent = text;
    rec.kidsBtn.setAttribute("aria-expanded", item.kids ? "true" : "false");
    rec.kidsBtn.setAttribute("aria-label", `${rec.kidCount} ${rec.kidCount === 1 ? "child" : "children"}`);
    rec.kidsBtn.setAttribute("data-tip", "kids");
    rec.kidsBtn.setAttribute("data-tip-state", item.kids ? "on" : "off");
  };

  // ---------------------------------------------------------------- content
  const renderBlocks = (parent, blocks, depth, budget) => {
    for (const b of blocks) {
      if (budget.n >= CONTENT_LIMIT) return;
      const s = childString(b);
      // Task attributes are chips. Their children stay in the block and are never rewritten by Plexus.
      if (skipChildString(s)) continue;
      budget.n += 1;
      const rowUid = childUid(b);
      if (isRoamTableString(s)) {
        mountTableHost(parent, rowUid, budget);
        continue;
      }
      const row = el("div", "pxd-block", parent);
      row.dataset.uid = rowUid;
      row.setAttribute("data-pxd-row", rowUid);
      const posterCount = embedSplit(String(s || ""), embedOptsFor(rowUid)).posters.length;
      holdHeight(row, posterCount ? embedBoxFor(rowUid).h : KID_ROW_H);
      const node = renderRowRoot(row, s, "pxd-rs pxd-block__text", rowUid);
      budget.roots.push(node);
      const kids = childKids(b);
      if (kids.length && depth < CONTENT_DEPTH) {
        const wrap = el("div", "pxd-block__children", row);
        renderBlocks(wrap, kids, depth + 1, budget);
      }
    }
  };

  const openBoard = (uid) => { if (onOpenBoard) onOpenBoard(uid); else host?.openBlock?.(uid); };
  const commitBoardName = (uid, name) => (onRenameBoard || ((u, n) => session?.renameBoard?.(u, n)))(uid, name);


  // Board card body: a thumbnail of the child board (padded frame, titled minis, section frames, hairline connections),
  // the item count and, while untitled, a name field. `openUid` is the board the Open button navigates to.
  const mountBoardBody = (body, item, { openUid = item.uid } = {}) => {
    const innerW = Math.max(1, (Number(item.w) || 0) - 24);
    const preview = boardPreview(item, { aspect: innerW / Math.max(40, (Number(item.h) || 0) - HEADER_H - META_H) });
    const wrap = el("div", "pxd-item__board", body);
    const holder = el("div", "pxd-board-preview", wrap);
    if (preview.empty) {
      el("div", "pxd-board-preview__empty", holder).textContent = "Empty board";
    } else {
      const canvas = el("div", "pxd-board-preview__canvas", holder);
      const pct = (n) => `${Math.round(n * 10000) / 100}%`;
      const addMini = (r) => {
        const cls = ["pxd-mini"];
        if (r.type === "section") cls.push("pxd-mini--section");
        else if (r.type === "text") cls.push("pxd-mini--text");
        if (r.color) cls.push(`pxd-c-${r.color}`);
        if (r.w * innerW < TINY_MINI_PX) cls.push("pxd-mini--tiny");
        const mini = el("div", cls.join(" "), canvas);
        mini.style.left = pct(r.x);
        mini.style.top = pct(r.y);
        mini.style.width = pct(r.w);
        mini.style.height = pct(r.h);
        // Ref and image cards have no text of their own: use the referenced block's first line, or the kind.
        let title = r.title;
        if (!title && r.ref) {
          const text = host?.blockString?.(r.ref);
          if (typeof text === "string") title = firstLine(text).slice(0, REF_TITLE_MAX);
        }
        if (!title && r.kind === "image") title = "Image";
        if (title) el("div", "pxd-mini__title", mini).textContent = title;
      };
      // Sections first, then the connection hairlines, then cards on top (rects arrive sections-first).
      for (const r of preview.rects) if (r.type === "section") addMini(r);
      if (preview.edges.length) {
        const svg = doc.createElementNS(SVG_NS, "svg");
        svg.setAttribute("class", "pxd-board-preview__edges");
        svg.setAttribute("viewBox", "0 0 1 1");
        svg.setAttribute("preserveAspectRatio", "none");
        for (const e of preview.edges) {
          const line = doc.createElementNS(SVG_NS, "line");
          line.setAttribute("x1", String(e.x1));
          line.setAttribute("y1", String(e.y1));
          line.setAttribute("x2", String(e.x2));
          line.setAttribute("y2", String(e.y2));
          svg.append(line);
        }
        canvas.append(svg);
      }
      for (const r of preview.rects) if (r.type !== "section") addMini(r);
    }
    if (item.enhanced && isUntitledBoard(item.title)) {
      const input = el("input", "pxd-input pxd-item__board-name", wrap);
      input.type = "text";
      input.setAttribute("aria-label", "Board name");
      input.placeholder = "Name this board…";
      input.setAttribute("placeholder", "Name this board…");
      for (const type of ["pointerdown", "mousedown", "click", "dblclick"]) input.addEventListener(type, stopEvent);
      let done = false;
      const commit = () => {
        if (done) return;
        const name = String(input.value || "").trim();
        if (!name) return;
        done = true;
        commitBoardName(item.uid, name);
      };
      input.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Enter") { event.preventDefault(); commit(); input.blur?.(); }
        else if (event.key === "Escape") { event.preventDefault(); input.value = ""; input.blur?.(); }
      });
      input.addEventListener("blur", commit);
    }
    const meta = el("div", "pxd-item__board-meta", wrap);
    el("span", "pxd-item__board-count", meta).textContent = `${preview.count} ${preview.count === 1 ? "item" : "items"}`;
    const open = el("button", "pxd-btn pxd-item__open", meta);
    open.type = "button";
    open.textContent = "Open";
    open.setAttribute("aria-label", "Open");
    open.dataset.action = "open";
    for (const type of ["pointerdown", "mousedown", "dblclick"]) open.addEventListener(type, stopEvent);
    open.addEventListener("click", (event) => { event.stopPropagation(); openBoard(openUid); });
  };

  // ---- page cards (PG-1): the whole outline, rows tagged data-pxd-row, folded blocks folded.
  // EK-3: how long each page card took from mount to its first paint (pull, or cache hit, plus the plain rows).
  const notePageMount = (title, ms, rows, cached) => {
    const bag = host?.stats;
    if (!bag || typeof bag !== "object") return;
    if (!Array.isArray(bag.pageMounts)) bag.pageMounts = [];
    const entry = { title, ms: Math.round(ms * 10) / 10, rows, cached, at: Math.round(now()), firstLiveMs: null, primed: null };
    bag.pageMounts.push(entry);
    if (bag.pageMounts.length > 50) bag.pageMounts.shift();
    return entry;
  };
  // A pulled outline stays cached while a page watch for that title is armed, including through the
  // debounce. The watch bumps a generation; the refresh pulls once for that generation and every card
  // of the title shares it. The last card to leave drops the cache.
  const outlineCache = new Map();
  const watchGen = new Map();
  const cacheGen = new Map();
  const watchedTitles = new Map();
  const fetchPage = (title, force = false) => {
    const hit = outlineCache.get(title);
    const watched = (watchedTitles.get(title) || 0) > 0;
    const gen = watchGen.get(title) || 0;
    if (hit && watched && !force) return hit;
    if (hit && force && cacheGen.get(title) === gen) return hit;
    const got = host?.pageOutline
      ? host.pageOutline(title, OUTLINE_FETCH)
      : host?.pagePreview?.(title, 64, OUTLINE_FETCH);
    if (got && typeof got.then !== "function") {
      outlineCache.set(title, got);
      cacheGen.set(title, gen);
    }
    return got;
  };
  const pageKeyOf = (blocks) => {
    const parts = [];
    const walk = (list) => {
      for (const c of list) {
        parts.push(childUid(c), childString(c), c.open === false ? "0" : "1");
        walk(childKids(c));
      }
    };
    walk(blocks || []);
    return parts.join("\u0001");
  };
  const countRows = (blocks) => {
    let n = 0;
    for (const c of blocks) {
      if (skipChildString(childString(c))) continue;
      n += 1;
      if (c.open !== false) n += countRows(childKids(c));
    }
    return n;
  };
  const openPageByTitle = (title, uid) => {
    const id = uid || host?.pageUid?.(title);
    if (id) host?.openPage?.(id);
  };
  const moreRow = (parent, n, title, uid) => {
    const more = el("button", "pxd-row__more", parent);
    more.type = "button";
    more.textContent = `+${n} more`;
    more.setAttribute("aria-label", `${n} more blocks, open the page`);
    for (const type of ["pointerdown", "mousedown", "dblclick"]) more.addEventListener(type, stopEvent);
    more.addEventListener("click", (event) => { stopEvent(event); openPageByTitle(title, uid); });
    return more;
  };
  // EK-3: every row paints as plain text first. The scheduler upgrades the rows on screen (heavy ones last) in idle
  // chunks; the observers tell it which rows those are. Without IntersectionObserver every row upgrades in turn.
  const upgradeRow = (rec, uid) => {
    const row = rec.rowTable?.get(uid);
    if (!row || disposed) return;
    rec.rowTable.delete(uid);
    rec.rowIO?.unobserve?.(row.plain);
    rec.rowIOHeavy?.unobserve?.(row.plain);
    if (!row.plain.isConnected) return;
    holdHeight(row.line, KID_ROW_H);
    const root = renderRowRoot(row.line, row.string, "pxd-rs pxd-block__text", uid);
    row.plain.remove();
    rec.roots.push(root);
    rec.pageRoots?.push(root);
    if (rec.mountStat && rec.mountStat.firstLiveMs === null) rec.mountStat.firstLiveMs = Math.round(now() - rec.mountStat.at);
    onPageLayout?.(rec.uid);
  };
  const addPlainRow = (rec, line, string, uid) => {
    if (!rec.rowTable) return;
    holdHeight(line, KID_ROW_H);
    const heavy = isHeavyRow(string);
    const plain = el("div", `pxd-block__text pxd-block__plain${heavy ? " pxd-block__plain--heavy" : ""}`, line);
    plain.textContent = heavy ? "\u2026" : plainText(string);
    plain.setAttribute("data-pxd-plain", uid);
    rec.rowTable.set(uid, { line, plain, string, heavy });
    const io = heavy ? rec.rowIOHeavy : rec.rowIO;
    rec.rowSched.add(uid, { heavy, wanted: !io });
    io?.observe(plain);
  };
  // EK-4: a page card that carries a block arrow re-measures its rows whenever its content changes size (a chart or an
  // image above the row loads late, a row upgrades, a fold opens). One ResizeObserver per such card, batched to a frame.
  const layoutSet = new Set();
  const dropLayoutWatch = (rec) => {
    const w = rec.layoutWatch;
    if (!w) return;
    rec.layoutWatch = null;
    try { w.ro.disconnect(); } catch { /* already off */ }
    w.cancel?.();
  };
  const armLayoutWatch = (rec) => {
    if (rec.layoutWatch || disposed || !rec.pageHolder || !layoutSet.has(rec.uid)) return;
    const RO = doc.defaultView?.ResizeObserver || globalThis.ResizeObserver;
    if (typeof RO !== "function") return;
    const w = { ro: null, cancel: null, queued: false };
    w.ro = new RO(() => {
      if (w.queued || disposed) return;
      w.queued = true;
      w.cancel = frameLater(() => {
        w.queued = false;
        w.cancel = null;
        if (!disposed && rec.layoutWatch === w) onPageLayout?.(rec.uid);
      });
    });
    try { w.ro.observe(rec.pageHolder); } catch { return; }
    rec.layoutWatch = w;
  };
  const setLayoutWatch = (uids) => {
    layoutSet.clear();
    for (const uid of uids || []) layoutSet.add(uid);
    for (const [uid, rec] of shells) {
      if (layoutSet.has(uid)) armLayoutWatch(rec);
      else dropLayoutWatch(rec);
    }
  };
  const startRowSched = (rec) => {
    stopRowSched(rec);
    rec.rowTable = new Map();
    // Page rows stay on the 8 ms budget. speed-flags.budgetedMount gates card bodies only.
    rec.rowSched = createRowScheduler({ idle: (fn) => idle(fn, true), now, budgetMs: CHUNK_MS, render: (uid) => upgradeRow(rec, uid) });
    const IO = doc.defaultView?.IntersectionObserver || globalThis.IntersectionObserver;
    if (typeof IO !== "function" || !rec.body) return;
    const onSee = (entries) => {
      for (const en of entries) {
        const id = en.target?.getAttribute?.("data-pxd-plain");
        if (id) rec.rowSched?.want(id, en.isIntersecting);
      }
    };
    try {
      rec.rowIO = new IO(onSee, { root: rec.body, rootMargin: "100% 0px 100% 0px" });
      rec.rowIOHeavy = new IO(onSee, { root: rec.body, rootMargin: "0px" });
    } catch {
      rec.rowIO = null;
      rec.rowIOHeavy = null;
    }
  };
  // The row IntersectionObserver reports what is on screen. Measuring every row here forces a layout
  // on each refresh, which is the hitch while typing. Without an observer every row is already wanted.
  const primeRows = (rec) => {
    if (!rec.rowSched || !rec.rowTable?.size) return 0;
    if (rec.rowIO || rec.rowIOHeavy) return 0;
    let n = 0;
    for (const uid of rec.rowTable.keys()) {
      rec.rowSched.want(uid, true);
      n += 1;
    }
    return n;
  };
  const stopRowSched = (rec) => {
    rec.rowSched?.dispose?.();
    rec.rowSched = null;
    try { rec.rowIO?.disconnect?.(); } catch { /* already off */ }
    try { rec.rowIOHeavy?.disconnect?.(); } catch { /* already off */ }
    rec.rowIO = null;
    rec.rowIOHeavy = null;
    rec.rowTable = null;
  };
  const childWithClass = (node, cls) => {
    for (const child of node?.children || []) if (child.classList?.contains(cls)) return child;
    return null;
  };
  const buildOutlineRow = (parent, spec, rec, b) => {
    const { uid, string: s, folded, hasKids, kids, depth } = spec;
    const row = el("div", "pxd-block pxd-prow", parent);
    row.dataset.uid = uid;
    row.setAttribute("data-uid", uid);
    row.__pxdKids = kids;
    const line = el("div", "pxd-row", row);
    line.dataset.pxdRow = uid;
    line.setAttribute("data-pxd-row", uid);
    let fold = null;
    if (hasKids) {
      fold = el("button", "pxd-row__fold", line);
      fold.type = "button";
      fold.setAttribute("aria-label", folded ? "Unfold" : "Fold");
      fold.setAttribute("aria-expanded", folded ? "false" : "true");
      for (const type of ["pointerdown", "mousedown", "dblclick"]) fold.addEventListener(type, stopEvent);
    }
    const posters = embedSplit(s, embedOptsFor(uid)).posters;
    if (isRoamTableString(s)) {
      const root = renderRowRoot(line, s, "pxd-rs pxd-block__text", uid);
      if (root.classList?.contains("pxd-roam-table") || root.querySelector?.(".pxd-rs__live")) b.roots.push(root);
    } else if (posters.length) {
      holdHeight(row, embedBoxFor(uid).h);
      const root = renderRoot(line, s, "pxd-rs pxd-block__text", uid);
      if (root.classList?.contains("pxd-embed-live") || root.querySelector?.(".pxd-rs__live")) b.roots.push(root);
    } else {
      holdHeight(line, KID_ROW_H);
      addPlainRow(rec, line, s, uid);
    }
    if (!hasKids) return row;
    const wrap = el("div", "pxd-block__children", row);
    let filled = !folded;
    const fill = () => {
      if (filled) return;
      filled = true;
      startRows();
      const sub = { n: b.n, more: 0, roots: [] };
      renderOutline(wrap, row.__pxdKids || [], sub, rec, depth + 1, uid);
      b.n = sub.n;
      if (sub.more) moreRow(wrap, sub.more, rec.pageTitle, rec.pageUid);
      if (rec.pageHolder && rec.pageHolder.isConnected !== false) { rec.pageRoots.push(...sub.roots); rec.roots.push(...sub.roots); }
    };
    if (folded) setHidden(wrap, true);
    row.classList.toggle("pxd-prow--folded", folded);
    fold.addEventListener("click", (event) => {
      stopEvent(event);
      const open = fold.getAttribute("aria-expanded") !== "true";
      if (open) fill();
      fold.setAttribute("aria-expanded", open ? "true" : "false");
      fold.setAttribute("aria-label", open ? "Fold" : "Unfold");
      row.classList.toggle("pxd-prow--folded", !open);
      setHidden(wrap, !open);
      onPageLayout?.(rec.uid);
    });
    return row;
  };
  const renderOutline = (parent, blocks, b, rec, depth = 0, parentUid = null) => {
    if (!rec.rowState) rec.rowState = new Map();
    for (const blk of blocks || []) {
      const s = childString(blk);
      if (skipChildString(s)) continue;
      const uid = childUid(blk);
      const kids = isRoamTableString(s) ? [] : childKids(blk);
      const hasKids = kids.length > 0;
      const folded = blk.open === false && hasKids;
      if (b.n >= OUTLINE_CAP) { b.more += 1 + (folded ? 0 : countRows(kids)); continue; }
      b.n += 1;
      const spec = { uid, string: s, depth, parentUid, folded, hasKids, kids };
      const row = buildOutlineRow(parent, spec, rec, b);
      rec.rowState.set(uid, { string: s, depth, parentUid, folded, hasKids });
      if (hasKids && !folded) renderOutline(childWithClass(row, "pxd-block__children"), kids, b, rec, depth + 1, uid);
    }
  };
  // Same walk as renderOutline, from the root, so a refresh can match rows already on screen.
  const outlinePlan = (blocks) => {
    const specs = [];
    let more = 0;
    let n = 0;
    const walk = (list, depth, parentUid) => {
      for (const blk of list || []) {
        const s = childString(blk);
        if (skipChildString(s)) continue;
        const uid = childUid(blk);
        const kids = isRoamTableString(s) ? [] : childKids(blk);
        const hasKids = kids.length > 0;
        const folded = blk.open === false && hasKids;
        if (n >= OUTLINE_CAP) { more += 1 + (folded ? 0 : countRows(kids)); continue; }
        n += 1;
        specs.push({ uid, string: s, depth, parentUid, folded, hasKids, kids });
        if (hasKids && !folded) walk(kids, depth + 1, uid);
      }
    };
    walk(blocks, 0, null);
    return { specs, more };
  };
  const releaseRowRoot = (rec, uid, prow) => {
    const entry = rec.rowTable?.get(uid);
    if (entry?.plain) {
      rec.rowIO?.unobserve?.(entry.plain);
      rec.rowIOHeavy?.unobserve?.(entry.plain);
      rec.rowTable.delete(uid);
      rec.rowSched?.drop?.(uid);
    }
    const line = childWithClass(prow, "pxd-row");
    const live = [...(line?.children || [])].find((node) => node.classList?.contains("pxd-rs") || node.classList?.contains("pxd-embed-live") || node.classList?.contains("pxd-rs--board"));
    if (!live) return;
    try { live.__pxdEmbedMo?.disconnect(); } catch { /* already gone */ }
    try { host?.unmount?.(live.querySelector?.(".pxd-rs__live") || embedLive(live)); } catch { /* not a roam root */ }
    if (rec.pageRoots) rec.pageRoots = rec.pageRoots.filter((node) => node !== live);
    if (rec.roots) rec.roots = rec.roots.filter((node) => node !== live);
  };
  const patchRowString = (rec, prow, spec) => {
    const line = childWithClass(prow, "pxd-row");
    const entry = rec.rowTable?.get(spec.uid);
    if (entry?.plain?.isConnected !== false && entry?.plain) {
      const heavy = isHeavyRow(spec.string);
      if (entry.heavy !== heavy) rec.rowSched?.retarget?.(spec.uid, { heavy });
      entry.string = spec.string;
      entry.heavy = heavy;
      entry.plain.classList.toggle("pxd-block__plain--heavy", heavy);
      entry.plain.textContent = heavy ? "\u2026" : plainText(spec.string);
      return;
    }
    const live = [...(line?.children || [])].find((node) => node.classList?.contains("pxd-rs") || node.classList?.contains("pxd-embed-live") || node.classList?.contains("pxd-rs--board"));
    if (isRoamTableString(spec.string) && live?.classList?.contains("pxd-roam-table")) return;
    const dropLive = () => {
      try { live.__pxdEmbedMo?.disconnect(); } catch { /* already gone */ }
      try { host?.unmount?.(live.querySelector?.(".pxd-rs__live") || embedLive(live)); } catch { /* not a roam root */ }
      if (rec.pageRoots) rec.pageRoots = rec.pageRoots.filter((node) => node !== live);
      if (rec.roots) rec.roots = rec.roots.filter((node) => node !== live);
      live.remove();
    };
    if (isRoamTableString(spec.string)) {
      if (live) dropLive();
      const node = mountTableHost(line, spec.uid);
      for (const name of ["pxd-rs", "pxd-block__text"]) node.classList.add(name);
      rec.pageRoots = [...(rec.pageRoots || []), node];
      rec.roots = [...(rec.roots || []), node];
      return;
    }
    if (live?.classList?.contains("pxd-roam-table")) {
      dropLive();
      addPlainRow(rec, line, spec.string, spec.uid);
      return;
    }
    const split = embedSplit(spec.string, embedOptsFor(spec.uid));
    if (!live) {
      if (split.posters.length) {
        const root = renderRoot(line, spec.string, "pxd-rs pxd-block__text", spec.uid);
        if (root.classList?.contains("pxd-embed-live") || root.querySelector?.(".pxd-rs__live")) {
          rec.pageRoots = [...(rec.pageRoots || []), root];
          rec.roots = [...(rec.roots || []), root];
        }
      } else addPlainRow(rec, line, spec.string, spec.uid);
      return;
    }
    if (live.classList.contains("pxd-embed-live") || live.classList.contains("pxd-rs--board") || split.posters.length) {
      try { live.__pxdEmbedMo?.disconnect(); } catch { /* already gone */ }
      try { host?.unmount?.(live.querySelector?.(".pxd-rs__live") || embedLive(live)); } catch { /* not a roam root */ }
      if (rec.pageRoots) rec.pageRoots = rec.pageRoots.filter((node) => node !== live);
      if (rec.roots) rec.roots = rec.roots.filter((node) => node !== live);
      live.remove();
      const root = renderRoot(line, spec.string, "pxd-rs pxd-block__text", spec.uid);
      if (root.classList?.contains("pxd-embed-live") || root.querySelector?.(".pxd-rs__live")) {
        rec.pageRoots = [...(rec.pageRoots || []), root];
        rec.roots = [...(rec.roots || []), root];
      }
      return;
    }
    const inner = childWithClass(live, "pxd-rs__live") || embedLive(live);
    if (inner && host?.renderString) {
      try { host.renderString(inner, spec.string); return; } catch { /* plain text below */ }
    }
    if (inner) inner.textContent = plainText(spec.string);
  };
  const syncFold = (prow, spec) => {
    const fold = childWithClass(childWithClass(prow, "pxd-row"), "pxd-row__fold");
    if (fold) {
      fold.setAttribute("aria-expanded", spec.folded ? "false" : "true");
      fold.setAttribute("aria-label", spec.folded ? "Unfold" : "Fold");
    }
    prow.classList.toggle("pxd-prow--folded", spec.folded);
    const wrap = childWithClass(prow, "pxd-block__children");
    if (wrap) setHidden(wrap, spec.folded);
  };
  const reorderProws = (parent, rows) => {
    let tail = null;
    for (const child of parent.children || []) {
      if (!child.classList?.contains("pxd-prow")) { tail = child; break; }
    }
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const next = i + 1 < rows.length ? rows[i + 1] : tail;
      if (row.parentElement === parent && row.nextElementSibling === (next || null)) continue;
      if (next && next.parentElement === parent) parent.insertBefore(row, next);
      else parent.append(row);
    }
  };
  const syncTail = (parent, cls, text) => {
    let node = null;
    for (const child of [...(parent.children || [])]) if (child.classList?.contains(cls)) node = child;
    if (text == null) { node?.remove(); return node; }
    if (!node) return null;
    if (node.textContent !== text) node.textContent = text;
    return node;
  };
  // Keeps the row elements. A string, order, or depth change patches that row and leaves every other live root mounted.
  const patchPage = (rec, holder, p) => {
    const nextKey = pageKeyOf(p.blocks);
    if (nextKey === rec.pageKey) return [];
    const prevState = rec.rowState;
    const { specs, more } = outlinePlan(p.blocks);
    const byUid = new Map();
    for (const prow of holder.querySelectorAll?.(".pxd-prow") || []) {
      const uid = prow.getAttribute?.("data-uid");
      if (uid && !byUid.has(uid)) byUid.set(uid, prow);
    }
    const keep = new Set(specs.map((spec) => spec.uid));
    for (const [uid, prow] of [...byUid]) {
      if (keep.has(uid)) continue;
      releaseRowRoot(rec, uid, prow);
      if (prow.parentElement) prow.remove();
      byUid.delete(uid);
    }
    for (const spec of specs) {
      const prow = byUid.get(spec.uid);
      if (!prow) continue;
      const hasBtn = Boolean(childWithClass(childWithClass(prow, "pxd-row"), "pxd-row__fold"));
      if (hasBtn === spec.hasKids) continue;
      releaseRowRoot(rec, spec.uid, prow);
      if (prow.parentElement) prow.remove();
      byUid.delete(spec.uid);
    }
    rec.pageTitle = p.title || rec.pageTitle || "";
    rec.pageUid = p.uid || rec.pageUid || null;
    const bucket = { n: specs.length, more: 0, roots: [] };
    const created = new Set();
    for (const spec of specs) {
      if (byUid.has(spec.uid)) continue;
      const parent = spec.parentUid
        ? (childWithClass(byUid.get(spec.parentUid), "pxd-block__children") || holder)
        : holder;
      const row = buildOutlineRow(parent, spec, rec, bucket);
      byUid.set(spec.uid, row);
      created.add(spec.uid);
    }
    for (const spec of specs) {
      const prow = byUid.get(spec.uid);
      if (!prow || created.has(spec.uid)) continue;
      prow.__pxdKids = spec.kids;
      const prev = prevState.get(spec.uid);
      if (!prev || prev.string !== spec.string) patchRowString(rec, prow, spec);
      if (!prev || prev.folded !== spec.folded || prev.hasKids !== spec.hasKids) syncFold(prow, spec);
    }
    const groups = new Map();
    for (const spec of specs) {
      const prow = byUid.get(spec.uid);
      if (!prow) continue;
      const parent = spec.parentUid
        ? (childWithClass(byUid.get(spec.parentUid), "pxd-block__children") || holder)
        : holder;
      if (!groups.has(parent)) groups.set(parent, []);
      groups.get(parent).push(prow);
    }
    for (const [parent, rows] of groups) reorderProws(parent, rows);
    if (more) {
      const text = `+${more} more`;
      if (!syncTail(holder, "pxd-row__more", text)) moreRow(holder, more, rec.pageTitle, rec.pageUid);
    } else syncTail(holder, "pxd-row__more", null);
    if (!specs.length) {
      if (!syncTail(holder, "pxd-item__placeholder", "Empty page")) el("div", "pxd-item__placeholder", holder).textContent = "Empty page";
    } else syncTail(holder, "pxd-item__placeholder", null);
    const next = new Map();
    for (const spec of specs) next.set(spec.uid, { string: spec.string, depth: spec.depth, parentUid: spec.parentUid, folded: spec.folded, hasKids: spec.hasKids });
    rec.rowState = next;
    rec.pageKey = nextKey;
    if (bucket.roots.length) rec.pageRoots = [...(rec.pageRoots || []), ...bucket.roots];
    armLayoutWatch(rec);
    onPageLayout?.(rec.uid);
    return bucket.roots;
  };
  // First paint builds the outline. A later refresh patches rows in place.
  const paintPage = (rec, holder, p) => {
    if (p?.exists && rec.rowState?.size && holder.querySelector?.(".pxd-prow")) return patchPage(rec, holder, p);
    startRows();
    const old = new Set(rec.pageRoots || []);
    for (const node of old) {
      try { node.__pxdEmbedMo?.disconnect(); } catch { /* already gone */ }
      try { host?.unmount?.(node.querySelector?.(".pxd-rs__live") || embedLive(node)); } catch { /* not a roam root */ }
    }
    if (old.size && rec.roots) rec.roots = rec.roots.filter((node) => !old.has(node));
    startRowSched(rec);
    holder.replaceChildren();
    rec.pageRoots = [];
    rec.rowState = new Map();
    rec.pageTitle = p?.title || rec.pageTitle || "";
    if (!p?.exists) {
      rec.pageKey = "";
      el("div", "pxd-item__placeholder", holder).textContent = "Empty page";
      onPageLayout?.(rec.uid);
      return [];
    }
    rec.pageUid = p.uid || null;
    rec.pageKey = pageKeyOf(p.blocks);
    const b = { n: 0, more: 0, roots: [] };
    renderOutline(holder, p.blocks || [], b, rec);
    if (!b.n) el("div", "pxd-item__placeholder", holder).textContent = "Empty page";
    if (b.more) moreRow(holder, b.more, rec.pageTitle, rec.pageUid);
    rec.pageRoots = [...b.roots];
    rec.primed = primeRows(rec);
    armLayoutWatch(rec);
    onPageLayout?.(rec.uid);
    return b.roots;
  };

  // BA-3: where a page card row sits, relative to the card top, in world px (screen px / zoom). Null when the card
  // has no rendered outline to measure (not mounted, editing, map tier): the edge then keeps its plain side point.
  const round1 = (n) => Math.round(n * 10) / 10;
  const measureRow = (uid, rowUid) => {
    const rec = shells.get(uid);
    const holder = rec?.pageHolder;
    if (!rec?.body || !holder || holder.isConnected === false || editing?.uid === uid || !rec.pageKey) return null;
    const z = zoomCache || 1;
    const card = rec.el.getBoundingClientRect();
    const body = rec.body.getBoundingClientRect();
    const out = { bodyTop: round1((body.top - card.top) / z), bodyBottom: round1((body.bottom - card.top) / z) };
    const row = holder.querySelector?.(`[data-pxd-row="${rowUid}"]`);
    const r = row ? row.getBoundingClientRect() : null;
    if (!r || (!r.width && !r.height)) return { ...out, rowTop: null, rowHeight: 0, rendered: false };
    const cardLeft = card.left;
    return { ...out, rowTop: round1((r.top - card.top) / z), rowHeight: round1(r.height / z), rowLeft: round1((r.left - cardLeft) / z), rowRight: round1((r.right - cardLeft) / z), rendered: true };
  };
  // RF-2: rows that a block arrow ends on carry a persistent mark (class, edge color, edge uids, tooltip text).
  // `entries` = [{ card, row, edges: [uid], color, tip }]; rows marked before and absent now are cleared.
  const markedRows = new Set();
  const rowOf = (uid, rowUid) => shells.get(uid)?.pageHolder?.querySelector?.(`[data-pxd-row="${rowUid}"]`) ?? null;
  const unmarkRow = (row) => {
    row.classList.remove("pxd-row--linked", "pxd-row--hot");
    row.style.removeProperty("--pxd-row-line");
    row.removeAttribute("data-pxd-edges");
    row.removeAttribute("data-tip");
    row.removeAttribute("data-tip-extra");
  };
  const markRows = (entries) => {
    const keep = new Set();
    for (const en of entries || []) {
      const row = rowOf(en.card, en.row);
      if (!row) continue;
      keep.add(row);
      row.classList.add("pxd-row--linked");
      if (en.color) row.style.setProperty("--pxd-row-line", en.color); else row.style.removeProperty("--pxd-row-line");
      row.setAttribute("data-pxd-edges", en.edges.join(" "));
      row.setAttribute("data-tip", "edge.row");
      row.setAttribute("data-tip-extra", en.tip || "");
      markedRows.add(row);
    }
    for (const row of [...markedRows]) {
      if (keep.has(row)) continue;
      markedRows.delete(row);
      unmarkRow(row);
    }
  };
  const setRowHot = (uid, rowUid, on) => {
    const row = rowOf(uid, rowUid);
    row?.classList?.toggle("pxd-row--hot", Boolean(on));
  };
  // Scrolls the body so the row is centered and flashes it. False when the row is not on screen to scroll to.
  const revealRow = (uid, rowUid) => {
    const rec = shells.get(uid);
    const row = rec?.pageHolder?.querySelector?.(`[data-pxd-row="${rowUid}"]`);
    if (!rec?.body || !row) return false;
    rec.rowSched?.renderNow?.(rowUid);
    const r = row.getBoundingClientRect();
    if (!r.width && !r.height) return false;
    const body = rec.body.getBoundingClientRect();
    const delta = (r.top + r.height / 2 - (body.top + body.height / 2)) / (zoomCache || 1);
    rec.body.scrollTop = Math.max(0, (Number(rec.body.scrollTop) || 0) + delta);
    row.classList.add("pxd-row--flash");
    later(() => row.classList.remove("pxd-row--flash"), 600);
    onPageLayout?.(uid);
    return true;
  };
  let pageWatches = 0;
  const pageListeners = new Map();
  const ensurePageWatch = (title) => {
    const existing = pageListeners.get(title);
    if (existing) return existing;
    if (pageWatches >= PAGE_WATCH_MAX || !host?.watchPage) return null;
    const fns = new Set();
    let off = null;
    try {
      off = host.watchPage(title, () => {
        watchGen.set(title, (watchGen.get(title) || 0) + 1);
        for (const fn of [...fns]) fn();
      });
    } catch { return null; }
    const slot = { off, fns };
    pageListeners.set(title, slot);
    pageWatches += 1;
    return slot;
  };
  const armPageWatch = (rec, item, holder) => {
    if (disposed || rec.pageUnwatch || !host?.watchPage) return;
    const slot = ensurePageWatch(item.title);
    if (!slot) return;
    let pending = null;
    const refresh = () => {
      pending = null;
      if (disposed || rec.pageHolder !== holder || holder.isConnected === false) return;
      let got;
      try { got = fetchPage(item.title, true); } catch { return; }
      Promise.resolve(got).then((p) => {
        if (disposed || editing?.uid === rec.uid || rec.pageHolder !== holder) return;
        if (p?.exists ? pageKeyOf(p.blocks) === rec.pageKey : rec.pageKey === "") return;
        const keep = Number(rec.body?.scrollTop) || 0;
        rec.roots.push(...paintPage(rec, holder, p));
        if (rec.body && keep) rec.body.scrollTop = keep;
      }).catch(() => {});
    };
    const onWatch = () => {
      if (pending) return;
      pending = later(refresh, PAGE_REFRESH_MS);
    };
    slot.fns.add(onWatch);
    watchedTitles.set(item.title, (watchedTitles.get(item.title) || 0) + 1);
    rec.pageUnwatch = () => {
      rec.pageUnwatch = null;
      slot.fns.delete(onWatch);
      const left = (watchedTitles.get(item.title) || 1) - 1;
      if (left > 0) watchedTitles.set(item.title, left);
      else {
        watchedTitles.delete(item.title);
        outlineCache.delete(item.title);
        watchGen.delete(item.title);
        cacheGen.delete(item.title);
        try { slot.off?.(); } catch { /* already off */ }
        pageListeners.delete(item.title);
        pageWatches -= 1;
      }
      pending?.();
      pending = null;
    };
  };

  // EK-2: the sticky body is the live Roam block while the sticky is on screen at detail zoom; a static render
  // otherwise (map zoom). A minimized sticky mounts nothing. Focus in the live block is the sticky's "editing"
  // state, so a click types at once and nothing swaps in or out.
  const mountSticky = (rec, item, budget) => {
    if (item.min) return;
    if (lod !== "detail" || !host?.renderBlock) {
      budget.roots.push(renderRoot(rec.body, item.string, "pxd-rs pxd-item__text", item.uid));
      return;
    }
    const editor = el("div", "pxd-item__editor pxd-item__editor--sticky", rec.body);
    // The whole body is Roam's while the block is live, so a press on the paper under the text never starts a drag.
    // The header stays the board's: that is the drag handle.
    if (!rec.bodyWired) {
      rec.bodyWired = true;
      for (const type of EDITOR_STOPPED) rec.body.addEventListener(type, (event) => { if (rec.stickyLive) event.stopPropagation(); });
      rec.body.addEventListener("click", (event) => {
        if (disposed || !rec.stickyLive || event.target?.closest?.(".rm-block")) return;
        if (editing?.uid !== rec.uid) void focusSticky(rec.uid);
      });
    }
    try { host.renderBlock(editor, item.uid); }
    catch {
      editor.remove();
      budget.roots.push(renderRoot(rec.body, item.string, "pxd-rs pxd-item__text", item.uid));
      return;
    }
    const onIn = () => { if (!disposed && editing?.uid !== rec.uid) beginStickyEdit(rec); };
    const onOut = (event) => {
      if (event.relatedTarget && editor.contains?.(event.relatedTarget)) return;
      const e = editing;
      if (!e || e.uid !== rec.uid) return;
      e.leave?.();
      e.leave = later(() => {
        if (editing !== e || disposed) return;
        if (editor.contains?.(doc.activeElement)) return;
        if (floor || !focusLost(doc.activeElement) || lastOutsideDown > now() - 300) endStickyEdit();
      }, 160);
    };
    editor.addEventListener("focusin", onIn);
    editor.addEventListener("focusout", onOut);
    rec.stickyOff = () => {
      editor.removeEventListener("focusin", onIn);
      editor.removeEventListener("focusout", onOut);
    };
    rec.editor = editor;
    rec.stickyLive = true;
    applyEditorCounterScale(editor, zoomCache);
    budget.roots.push(editor);
  };
  const detachStickyEditor = (rec) => {
    rec.stickyOff?.();
    rec.stickyOff = null;
  };
  const beginStickyEdit = (rec) => {
    if (editing && editing.uid !== rec.uid) void exitEdit({ silent: true });
    const item = lastBoard?.items.get(rec.uid);
    if (!item || !rec.editor) return;
    editing = { uid: rec.uid, rec, editor: rec.editor, targetUid: rec.uid, item, ready: true, sticky: true, fadeCancel: null, releaseCancel: null, leave: null };
    rec.el.classList.add("pxd-item--typing");
    lastOutsideDown = -Infinity;
    attachFocusGuard();
    attachFloor(editing);
    onEditChange?.(rec.uid);
    nudgeEditorMenus(doc);
  };
  const endStickyEdit = () => {
    const e = editing;
    if (!e?.sticky) return;
    e.leave?.();
    editing = null;
    detachFocusGuard();
    e.rec.el.classList.remove("pxd-item--typing");
    onEditChange?.(null);
  };
  const focusSticky = async (uid) => {
    const rec = shells.get(uid);
    const item = lastBoard?.items.get(uid);
    if (!rec || !item) return false;
    if (editing && editing.uid !== uid) await exitEdit();
    if (item.min) { await session?.setMinimized?.(uid, false); return true; }
    if (!rec.editor?.isConnected) {
      mountContent(rec, item);
      mounted.delete(uid);
      mounted.set(uid, now());
    }
    const editor = rec.editor;
    if (!editor) return false;
    await waitHydrateQuiet(editor, HYDRATE_CAP_MS);
    if (disposed || rec.editor !== editor) return false;
    const input = editor.querySelector?.("textarea") || editor.querySelector?.(".rm-block__input") || editor.querySelector?.(".rm-block-text");
    if (input) focusRoamInput(input);
    return true;
  };

  // PDF-1. One reader. Map lod keeps the cover at the card's own size.
  const pdfReaderBox = (uid) => {
    const item = lastBoard?.items.get(uid);
    if (onReadPane) return Boolean(item && !item.collapsed && item.kind === "pdf" && inlineUid === uid && lod === "detail");
    return Boolean(item && !item.collapsed && item.kind === "pdf" && pdfOpenUid === uid && lod === "detail");
  };
  // The open reader uses the card's own box, capped at PDF_CARD_MAX. Culling uses that box.
  const drawnRect = (uid, rect) => shownRect(uid, rect);
  const pdfSourceOf = (item) => {
    if (item?.target?.kind === "block") {
      const text = host?.blockString?.(item.target.uid);
      return typeof text === "string" ? text : "";
    }
    return typeof item?.string === "string" ? item.string : "";
  };
  const coverImageOf = (item) => {
    if (typeof coverImage !== "function") return null;
    const url = pdfMacroUrl(pdfSourceOf(item));
    if (!url) return null;
    try {
      const got = coverImage(url);
      return got && typeof got === "object" ? got : null;
    } catch {
      return null;
    }
  };
  const humanAlias = (item) => {
    const title = typeof item?.title === "string" ? item.title.trim() : "";
    if (!title || title === "PDF" || title.startsWith("{{") || title.startsWith("((")) return "";
    return title;
  };
  const humanText = (item) => {
    const text = typeof item?.string === "string" ? item.string.trim() : "";
    if (!text || text.startsWith("{{") || text.startsWith("((")) return "";
    return text;
  };
  const pdfCoverOf = (item) => {
    let cover = null;
    try { cover = host?.pdfCover?.(pdfSourceOf(item)); } catch { cover = null; }
    const url = pdfMacroUrl(pdfSourceOf(item));
    let metadataTitle = "";
    try {
      const got = typeof pdfMetaTitle === "function" ? pdfMetaTitle(url) : "";
      metadataTitle = typeof got === "string" ? got : "";
    } catch { metadataTitle = ""; }
    const model = coverModel({
      metadataTitle,
      alias: humanAlias(item),
      text: humanText(item),
      title: typeof cover?.title === "string" ? cover.title : "",
      url: (typeof cover?.url === "string" && cover.url) || url,
      count: cover?.count,
    });
    return { ...(cover && typeof cover === "object" ? cover : {}), ...model, image: coverImageOf(item) };
  };
  const applyPdfSize = (rec) => {
    if (!rec?.el || !rec.rect) return;
    const shown = shownRect(rec.uid, rec.rect);
    rec.el.style.width = `${shown.w}px`;
    rec.el.style.height = `${shown.h}px`;
  };
  const armPdfLiveWatch = () => {
    if (pdfLiveOff) return;
    const onKey = (event) => {
      if (event.key !== "Escape" || isTextEntryTarget(event.target)) return;
      endPdfInteract();
    };
    const onDown = (event) => {
      const reader = pdfLiveUid ? shells.get(pdfLiveUid)?.pdfReader : null;
      if (reader && event.target && reader.contains(event.target)) return;
      endPdfInteract();
    };
    doc.addEventListener?.("keydown", onKey, true);
    doc.addEventListener?.("pointerdown", onDown, true);
    pdfLiveOff = () => {
      doc.removeEventListener?.("keydown", onKey, true);
      doc.removeEventListener?.("pointerdown", onDown, true);
    };
  };
  const endPdfInteract = () => {
    const off = pdfLiveOff;
    pdfLiveOff = null;
    const uid = pdfLiveUid;
    pdfLiveUid = null;
    try { off?.(); } catch { /* already off */ }
    const rec = uid ? shells.get(uid) : null;
    rec?.el.classList.remove("pxd-pdf-live");
    const reader = rec?.pdfReader;
    if (!reader?.isConnected) return;
    try { reader.__pxdEmbedMo?.disconnect(); } catch { /* already stopped */ }
    armEmbedShield(reader, embedLive(reader));
  };
  const beginPdfInteract = (rec) => {
    const reader = rec?.pdfReader;
    if (!reader) return;
    rec.el.classList.add("pxd-pdf-live");
    pdfLiveUid = rec.uid;
    try { reader.__pxdEmbedMo?.disconnect(); } catch { /* already stopped */ }
    for (const shield of reader.querySelectorAll?.(".pxd-embed-shield") || []) shield.remove();
    armPdfLiveWatch();
  };
  const paintPdfCover = (rec, item, cover) => {
    try { rec.pdfCoverOff?.(); } catch { /* already off */ }
    rec.pdfCoverOff = null;
    rec.pdfReader = null;
    const safe = cover && typeof cover === "object" ? cover : coverModel({ count: 0 });
    const image = safe.image && typeof safe.image === "object" ? safe.image : null;
    const state = coverFace(image);
    const src = state === "ready" && typeof image.src === "string" ? image.src : "";
    const showImage = state === "ready" && src && lod === "detail";
    const titleText = String(safe.title || "PDF");
    const count = typeof safe.count === "number" && Number.isFinite(safe.count) && safe.count >= 1 ? safe.count : 0;
    const node = el("div", `pxd-pdf-cover pxd-pdf-cover--${state}`, rec.body);
    node.setAttribute("data-cover", state);
    // P32-1: the cached image also paints the map and overview tiers, as a CSS background on the paper.
    // The same data URL as the detail <img>, so the browser decodes it once per card. No DOM at those tiers.
    if (state === "ready" && src) {
      try { node.style.setProperty("--pxd-cover", `url("${src}")`); } catch { /* stub */ }
      node.setAttribute("data-cover-img", "1");
    }
    const paper = el("div", "pxd-pdf-paper", node);
    if (lod !== "overview") {
      if (showImage) {
        const img = el("img", "pxd-pdf-img", paper);
        img.alt = "";
        img.setAttribute("alt", "");
        img.setAttribute("decoding", "async");
        img.setAttribute("loading", "lazy");
        img.setAttribute("src", src);
        if (src.startsWith("blob:")) rec.pdfBlob = src;
      } else if (state === "loading") {
        const skel = el("div", "pxd-pdf-skel", paper);
        skel.setAttribute("aria-hidden", "true");
        for (let i = 0; i < 6; i += 1) el("span", "pxd-pdf-skel__line", skel);
      } else if (state === "error") {
        paintPdfGlyph(doc, paper, 28);
        el("div", "pxd-pdf-miss", paper).textContent = "Could not read";
      } else {
        paintPdfGlyph(doc, paper, 28);
      }
      // Detail ready is the page image alone. Loading and no-cover keep the title on the paper, and so does
      // map without an image. Map with an image is the page alone, as in Heptabase (P32-1).
      if ((lod === "map" && !src) || state === "loading" || state === "none") {
        const face = el("div", "pxd-pdf-title pxd-pdf-title--face", paper);
        face.textContent = titleText;
      }
    }
    const ticks = lod === "detail" && Array.isArray(image?.ticks) ? image.ticks : [];
    if (ticks.length) {
      const density = el("div", "pxd-pdf-density", node);
      density.setAttribute("aria-label", "Highlights");
      for (const tick of ticks) {
        const y01 = tickY01(tick);
        const page = tickPage(tick);
        const mark = el("button", "pxd-pdf-tick pxd-chrome", density);
        mark.type = "button";
        mark.style.top = `${y01 * 100}%`;
        mark.setAttribute("data-y01", String(y01));
        if (tick?.color) mark.setAttribute("data-color", String(tick.color));
        if (page != null) mark.setAttribute("data-page", String(page));
        mark.setAttribute("aria-label", page != null ? `Page ${page}` : "Highlight");
        const openTick = (event) => {
          stopEvent(event);
          if (event.type !== "click") return;
          try { onPdfOpen?.(item.uid, page ?? undefined); } catch { /* host */ }
        };
        for (const type of ["pointerdown", "mousedown", "dblclick"]) mark.addEventListener(type, stopEvent);
        mark.addEventListener("click", openTick);
      }
    }
    if (lod !== "overview") {
      const hover = el("div", "pxd-pdf-hover", node);
      if (!count) hover.setAttribute("hidden", "");
      const hoverTitle = el("div", "pxd-pdf-title", hover);
      hoverTitle.textContent = titleText;
      if (count) {
        const countEl = el("div", "pxd-pdf-count", hover);
        countEl.textContent = String(count);
        countEl.setAttribute("aria-label", typeof safe.label === "string" && safe.label ? safe.label : `${count} highlights`);
      }
      const coverChips = chipsFor(item);
      if (coverChips.length) paintPdfChipStrip(doc, hover, coverChips, chipHandlers(item));
      const open = el("button", "pxd-pdf-open pxd-pdf-pill pxd-chrome", node);
      open.type = "button";
      open.textContent = "Open";
      open.setAttribute("aria-label", "Open reader");
      for (const type of ["pointerdown", "mousedown", "dblclick"]) open.addEventListener(type, stopEvent);
      open.addEventListener("click", (event) => {
        stopEvent(event);
        openPdf(item.uid);
      });
    }
    const dot = el("span", "pxd-pdf-dot", node);
    dot.setAttribute("aria-hidden", "true");
    const pdfSelected = () => rec.selected === true || selectedPrimary === item.uid;
    const onKey = (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (!pdfSelected()) return;
      if (isTextEntryTarget(event.target)) return;
      const tag = String(event.target?.tagName || "").toLowerCase();
      if (tag === "button" || tag === "a" || tag === "input" || tag === "textarea" || tag === "select") return;
      if (event.target?.closest?.(".pxd-pdf-chip, .pxd-pdf-tick")) return;
      event.preventDefault?.();
      stopEvent(event);
      try { onPdfOpenRequest?.(item.uid); } catch { /* host */ }
    };
    const onDbl = (event) => {
      if (!pdfSelected()) return;
      if (event.target?.closest?.("button, a, .pxd-pdf-chip, .pxd-pdf-tick")) return;
      stopEvent(event);
      try { onPdfOpenRequest?.(item.uid); } catch { /* host */ }
    };
    rec.el.addEventListener("keydown", onKey);
    rec.el.addEventListener("dblclick", onDbl);
    rec.pdfCoverOff = () => {
      rec.el.removeEventListener("keydown", onKey);
      rec.el.removeEventListener("dblclick", onDbl);
      const blob = rec.pdfBlob;
      rec.pdfBlob = "";
      releaseBlob(blob);
      rec.pdfCoverOff = null;
    };
  };
  const paintPdfReader = (rec, item) => {
    const reader = el("div", "pxd-pdf-reader", rec.body);
    const readerChips = chipsFor(item);
    if (readerChips.length) paintPdfChipStrip(doc, reader, readerChips, chipHandlers(item));
    const live = el("div", "pxd-rs__live", reader);
    const uid = item.target?.kind === "block" ? item.target.uid : item.uid;
    try { host?.renderBlock?.(live, uid); } catch { /* host */ }
    armEmbedShield(reader, live);
    rec.pdfReader = reader;
    const interact = el("button", "pxd-pdf-interact pxd-chrome", reader);
    interact.type = "button";
    interact.textContent = "Interact";
    for (const type of ["pointerdown", "mousedown", "dblclick"]) interact.addEventListener(type, stopEvent);
    interact.addEventListener("click", (event) => {
      stopEvent(event);
      beginPdfInteract(rec);
    });
    reader.addEventListener("pointerdown", (event) => {
      if (!rec.el.classList.contains("pxd-pdf-live")) return;
      if (event.target?.closest?.(".pxd-chrome")) return;
      event.stopPropagation();
    });
    if (pdfLiveUid === rec.uid) beginPdfInteract(rec);
    return reader;
  };
  const remountPdf = (uid) => {
    const rec = shells.get(uid);
    const item = lastBoard?.items.get(uid);
    if (!rec || !item || editing?.uid === uid) return;
    mountContent(rec, item);
    mounted.delete(uid);
    mounted.set(uid, now());
    applyPdfSize(rec);
  };
  const shellHasEmbed = (rec, id) => {
    if (!rec?.el || !id) return false;
    const nodes = rec.el.querySelectorAll?.("[data-pxd-embed]") || [];
    for (const node of nodes) if (node.getAttribute?.("data-pxd-embed") === id) return true;
    return false;
  };
  const shellUidFor = (id) => {
    if (!id) return null;
    if (shells.has(id)) return id;
    for (const [shellUid, rec] of shells) {
      const item = lastBoard?.items.get(shellUid);
      if (item?.target?.uid === id) return shellUid;
      if (shellHasEmbed(rec, id)) return shellUid;
    }
    return null;
  };
  ownsOpen = (item) => {
    if (!pdfOpenUid || !item) return false;
    if (item.kind === "pdf") return pdfOpenUid === item.uid;
    if (item.uid === pdfOpenUid || item.target?.uid === pdfOpenUid) return true;
    if (heavyMounts(item).some((poster) => poster.uid === pdfOpenUid)) return true;
    return shellHasEmbed(shells.get(item.uid), pdfOpenUid);
  };
  const tellPane = (detail) => {
    if (typeof onReadPane !== "function") return;
    try { onReadPane(detail); } catch { /* host */ }
  };
  const paneItem = (uid) => {
    if (!uid || !lastBoard?.items) return null;
    const direct = lastBoard.items.get(uid);
    if (direct) return direct;
    for (const item of lastBoard.items.values()) {
      if (item?.target?.uid === uid) return item;
    }
    return null;
  };
  const blockUidOf = (item) => {
    if (!item) return "";
    if (item.target?.kind === "block" && item.target.uid) return item.target.uid;
    return item.uid || "";
  };
  const pageFieldOf = (box) => {
    if (!box?.querySelectorAll) return null;
    const inputs = [...box.querySelectorAll("input")];
    const pageField = inputs.find((node) => /^\d+$/.test(String(node.value || "").trim()));
    return pageField || inputs[0] || null;
  };
  openEmbed = (uid, opts = null) => {
    if (!uid || openingEmbed) return;
    // Selecting or focusing a PDF, when the side pane exists, does not open it and does not close
    // the reader that is already up. The pill, double-click, Enter, menu, and chips are not implicit.
    if (opts?.implicit === true && typeof onReadPane === "function") {
      const picked = paneItem(uid) || lastBoard?.items.get(uid);
      if (picked?.kind === "pdf") return;
    }
    // One live reader per board: opening the pane puts an inline card back to its cover. Selecting or
    // focusing the card that is reading inline (implicit) opens nothing else; an explicit open (pill,
    // double-click, highlight, menu) still goes to the pane.
    if (inlineUid && onReadPane) {
      if (uid === inlineUid && opts?.implicit === true) return;
      closeInline();
    }
    const forced = paneForce;
    paneForce = null;
    const rule = readerRule(pdfOpenUid, uid);
    if (!forced && !paneHl && rule.close == null && rule.open === (pdfOpenUid || null)) return;
    openingEmbed = true;
    try {
      const nextItem = paneItem(rule.open || uid);
      const nextIsPdf = Boolean(forced) || nextItem?.kind === "pdf";
      if (typeof onReadPane === "function" && nextIsPdf) {
        const prevShell = rule.close ? shellUidFor(rule.close) : null;
        const prevItem = rule.close ? paneItem(rule.close) : null;
        pdfOpenUid = rule.open || null;
        try { onEmbedOpen?.(pdfOpenUid); } catch { /* outline */ }
        if (rule.close) {
          if (pdfLiveUid && (pdfLiveUid === rule.close || pdfLiveUid === prevShell)) endPdfInteract();
          if (prevShell && prevItem && prevItem.kind !== "pdf") remountPdf(prevShell);
          try { onToast?.("Closed the other reader"); } catch { /* toast */ }
        }
        tellPane({
          open: true,
          cardUid: nextItem?.kind === "pdf" ? nextItem.uid : "",
          blockUid: forced?.blockUid || blockUidOf(nextItem) || uid,
          page: forced?.page ?? panePage,
          highlightUid: forced?.highlightUid || paneHl || undefined,
          source: forced?.source || (nextItem ? pdfSourceOf(nextItem) : ""),
        });
        return;
      }
      const prevShell = rule.close ? shellUidFor(rule.close) : null;
      pdfOpenUid = rule.open || null;
      try { onEmbedOpen?.(pdfOpenUid); } catch { /* outline */ }
      if (rule.close) {
        if (pdfLiveUid && (pdfLiveUid === rule.close || pdfLiveUid === prevShell)) endPdfInteract();
        if (onReadPane) {
          const prevItem = paneItem(rule.close);
          if (!prevItem || prevItem.kind === "pdf") tellPane({ open: false });
        }
        if (prevShell) remountPdf(prevShell);
        try { onToast?.("Closed the other reader"); } catch { /* toast */ }
      }
      const nextShell = rule.open ? shellUidFor(rule.open) : null;
      if (nextShell && nextShell !== prevShell) remountPdf(nextShell);
    } finally {
      openingEmbed = false;
    }
  };
  // P32-5: "Read inside the card". Explicit, from the menu only. The pane closes first (one live reader).
  const readInline = (uid) => {
    const rec = shells.get(uid);
    const item = lastBoard?.items.get(uid);
    if (!rec || !item || item.kind !== "pdf" || !onReadPane) return false;
    if (inlineUid === uid) return true;
    if (inlineUid) closeInline();
    if (pdfOpenUid) {
      pdfOpenUid = null;
      tellPane({ open: false });
    }
    inlineUid = uid;
    remountPdf(uid);
    return true;
  };
  const closeInline = () => {
    const uid = inlineUid;
    if (!uid) return false;
    inlineUid = null;
    if (pdfLiveUid === uid) endPdfInteract();
    remountPdf(uid);
    return true;
  };
  closeEmbed = () => {
    tellPane({ open: false });
    if (!pdfOpenUid && !pdfLiveUid) return;
    const prev = pdfOpenUid;
    const shell = prev ? shellUidFor(prev) : (pdfLiveUid && shells.has(pdfLiveUid) ? pdfLiveUid : null);
    const item = shell ? lastBoard?.items.get(shell) : null;
    pdfOpenUid = null;
    if (pdfLiveUid) endPdfInteract();
    if (onReadPane && item?.kind === "pdf") return;
    if (shell) remountPdf(shell);
  };
  const openPdf = (uid) => openEmbed(uid);
  const readerInput = (uid) => {
    if (onReadPane) {
      const paneBox = boardRoot()?.querySelector?.(".pxd-read .rm-pdf-container")
        || doc?.querySelector?.(".pxd-read .rm-pdf-container");
      const paneField = pageFieldOf(paneBox);
      if (paneField) return paneField;
    }
    const rec = shells.get(uid);
    return pageFieldOf(rec?.pdfReader?.querySelector?.(".rm-pdf-container"));
  };
  const openPdfAt = (uid, page, highlightUid) => {
    if (typeof uid !== "string" || uid === "") {
      paneForce = null;
      return Promise.resolve(false);
    }
    panePage = typeof page === "number" ? page : null;
    paneHl = typeof highlightUid === "string" && highlightUid ? highlightUid : null;
    try {
      if (pdfOpenUid !== uid || paneForce || paneHl) openPdf(uid);
    } finally {
      panePage = null;
      paneHl = null;
    }
    const started = now();
    const want = String(page);
    const confirm = () => {
      const input = readerInput(uid);
      if (input && input.value !== want) writeReaderPage(input, page);
    };
    const attempt = () => {
      const input = readerInput(uid);
      if (!input) return false;
      if (input.value === want) return true;
      const wrote = writeReaderPage(input, page);
      if (wrote) {
        later(confirm, 400);
        later(confirm, 1200);
      }
      return wrote && input.value === want;
    };
    if (attempt()) return Promise.resolve(true);
    return new Promise((resolve) => {
      let stop = null;
      const finish = (ok) => {
        try { stop?.(); } catch { /* already cleared */ }
        resolve(ok);
      };
      const tick = () => {
        if (attempt()) { finish(true); return; }
        if (now() - started >= 5000) { finish(false); return; }
        stop = later(tick, 100);
      };
      stop = later(tick, 100);
    });
  };
  const openPdfBlock = (blockUid, page, source, highlightUid) => {
    if (typeof blockUid !== "string" || blockUid === "") return Promise.resolve(false);
    paneForce = { blockUid, source: typeof source === "string" ? source : "", page, highlightUid };
    return openPdfAt(blockUid, page, highlightUid);
  };
  const flashItem = (uid) => {
    const shell = shells.get(uid)?.el;
    if (!shell?.classList) return;
    shell.classList.add("pxd-item--flash");
    later(() => { shell.classList.remove("pxd-item--flash"); }, 2000);
  };

  // PDF-2 / PDF-5. The bar carries the colour. An area image sets its ratio before renderString. The card stays unfilled.
  const highlightRatio = (natural) => {
    const w = natural?.w;
    const h = natural?.h;
    if (typeof w !== "number" || typeof h !== "number" || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return "";
    return `${w} / ${h}`;
  };
  const paintHighlight = (rec, item, budget) => {
    const hl = item.highlight;
    const uid = item.target?.uid || item.uid;
    try { rec.hlHoverOff?.(); } catch { /* already off */ }
    rec.hlHoverOff = null;
    if (typeof onHighlightHover === "function") {
      const enter = () => { try { onHighlightHover(uid, true); } catch { /* host */ } };
      const leave = () => { try { onHighlightHover(uid, false); } catch { /* host */ } };
      rec.el.addEventListener("mouseenter", enter);
      rec.el.addEventListener("mouseleave", leave);
      rec.hlHoverOff = () => {
        rec.el.removeEventListener("mouseenter", enter);
        rec.el.removeEventListener("mouseleave", leave);
        rec.hlHoverOff = null;
      };
    }
    const image = hl.image === true && lod === "detail";
    if (image) {
      const media = el("div", "pxd-highlight-media", rec.body);
      const ratio = highlightRatio(hl.natural);
      if (ratio) media.style.aspectRatio = ratio;
      if (hl.text) budget.roots.push(renderRoot(media, hl.text, "pxd-rs pxd-item__string", uid));
    }
    const bar = el("div", "pxd-highlight-bar", rec.body);
    bar.setAttribute("data-color", String(hl.color || ""));
    if (lod !== "detail") {
      const line = firstLine(hl.text || "");
      if (line) el("div", "pxd-highlight-line", rec.body).textContent = line;
      return;
    }
    if (!image && hl.text) budget.roots.push(renderRoot(rec.body, hl.text, "pxd-rs pxd-item__string pxd-highlight-quote", uid));
    rec.hlNote = typeof hl.note === "string" ? hl.note : "";
    rec.hlNoteBox = null;
    if (rec.hlNote.trim()) {
      rec.hlNoteBox = el("div", "pxd-highlight-note", rec.body);
      budget.roots.push(renderRoot(rec.hlNoteBox, rec.hlNote, "pxd-rs", uid));
    }
    const chipTitle = highlightChipTitle(hl.footer);
    const chipPage = highlightChipPage(hl);
    const foot = el("button", "pxd-highlight-foot pxd-highlight-chip pxd-chrome", rec.body);
    foot.type = "button";
    rec.hlFoot = foot;
    paintPdfGlyph(doc, foot, 16);
    if (chipTitle) el("span", "pxd-highlight-chip__title", foot).textContent = chipTitle;
    if (chipPage) el("span", "pxd-highlight-chip__page", foot).textContent = chipTitle ? ` · ${chipPage}` : chipPage;
    foot.setAttribute("aria-label", [chipTitle, chipPage].filter(Boolean).join(", ") || "Open highlight");
    // P32-4: one click does one thing. Shift-click is Roam's sidebar; a plain click follows the setting (host).
    const openFoot = (event) => {
      stopEvent(event);
      if (event.type !== "click") return;
      try { onHighlightOpen?.(item, { mode: event.shiftKey ? "sidebar" : "" }); } catch { /* host */ }
    };
    for (const type of ["pointerdown", "mousedown", "dblclick", "click"]) foot.addEventListener(type, openFoot);
    if (typeof onHighlightMenu === "function") {
      const more = el("button", "pxd-highlight-chip__more pxd-chrome", rec.body);
      more.type = "button";
      more.textContent = "▾";
      more.setAttribute("aria-label", "Where to open this highlight");
      more.setAttribute("aria-haspopup", "menu");
      const openMore = (event) => {
        stopEvent(event);
        if (event.type !== "click") return;
        try { onHighlightMenu(item, more); } catch { /* host */ }
      };
      for (const type of ["pointerdown", "mousedown", "dblclick", "click"]) more.addEventListener(type, openMore);
    }
    // PDFH-5. Note opens the highlight's note the way Roam's own note button does (sidebar, child focused).
    if (typeof onHighlightNote === "function" && item.target?.uid) {
      const noteBtn = el("button", "pxd-highlight-notebtn pxd-chrome", rec.body);
      noteBtn.type = "button";
      noteBtn.textContent = "Note";
      noteBtn.setAttribute("aria-label", "Open the note for this highlight");
      const openNote = (event) => {
        stopEvent(event);
        if (event.type !== "click") return;
        try { onHighlightNote(item.target.uid); } catch { /* host */ }
      };
      for (const type of ["pointerdown", "mousedown", "dblclick", "click"]) noteBtn.addEventListener(type, openNote);
    }
  };

  // A mounted ((uid)) card follows edits to its source. The board pull does not, and coversBlock
  // must not skip this watch. Offscreen cards never get here: content mounts only while wanted.
  const paintBlockString = (rec, refString, refUid) => {
    const body = rec.body;
    const prev = rec.blockStringNode;
    if (prev) {
      try { prev.__pxdEmbedMo?.disconnect(); } catch { /* already gone */ }
      try {
        const live = prev.querySelector?.(".pxd-rs__live");
        if (live) host?.unmount?.(live);
      } catch { /* not a roam root */ }
      const i = rec.roots?.indexOf(prev) ?? -1;
      if (i >= 0) rec.roots.splice(i, 1);
    }
    if (!body || typeof refString !== "string" || !refString.trim()) {
      prev?.remove?.();
      rec.blockStringNode = null;
      return;
    }
    try { body.querySelector?.(".pxd-item__placeholder")?.remove?.(); } catch { /* stub */ }
    const node = renderRoot(body, refString, "pxd-rs pxd-item__string", refUid);
    if (prev?.parentNode === body && typeof body.insertBefore === "function") body.insertBefore(node, prev);
    prev?.remove?.();
    rec.blockStringNode = node;
    if (!rec.roots) rec.roots = [];
    rec.roots.push(node);
  };
  const refreshBlockRef = (rec, item, after) => {
    if (disposed || editing?.uid === rec.uid || rec.body?.isConnected === false) return;
    const live = lastBoard?.items.get(rec.uid);
    if (!live || live.kind !== "block" || live.target?.uid !== item.target?.uid) return;
    const watched = after?.[":block/string"];
    const refString = typeof watched === "string" ? watched : null;
    if (refString == null || refString === rec.refString) return;
    rec.refString = refString;
    rec.refBoard = classifyString(refString).kind === "board";
    rec.refTitle = rec.refBoard ? (parseBoardTitle(refString) || "Untitled board") : firstLine(refString).slice(0, REF_TITLE_MAX);
    if (!rec.renaming && rec.header) rec.header.textContent = String(rec.refTitle || live.title || "").slice(0, HEADER_TEXT_MAX);
    if (rec.el) rec.el.setAttribute("aria-label", `${rec.refTitle || live.title || "Untitled"}, ${live.type}`);
    if (rec.refBoard) return;
    paintBlockString(rec, refString, live.target.uid);
  };
  // A card that mounts after its source changed off screen still holds the cached string.
  // Cards mounting together are checked against Roam in one query, after the paint.
  const freshPending = new Map(); // source uid -> [{ rec, item }]
  let freshTimer = null;
  const flushFresh = () => {
    freshTimer = null;
    if (disposed || !freshPending.size || typeof host?.blockStrings !== "function") { freshPending.clear(); return; }
    const batch = [...freshPending.entries()];
    freshPending.clear();
    let strings = null;
    try { strings = host.blockStrings(batch.map(([uid]) => uid), { fresh: true }); } catch { return; }
    for (const [uid, holders] of batch) {
      const value = strings?.get?.(uid);
      if (typeof value !== "string") continue;
      for (const { rec, item } of holders) refreshBlockRef(rec, item, { ":block/string": value });
    }
  };
  const checkBlockRefFresh = (rec, item) => {
    const ref = item.target?.uid;
    if (!ref) return;
    const list = freshPending.get(ref) || [];
    list.push({ rec, item });
    freshPending.set(ref, list);
    if (!freshTimer) freshTimer = later(flushFresh, BLOCK_REFRESH_MS);
  };
  // A highlight card shows its note (PDFH-5). The shared block watch also carries children, so
  // an edit to the note repaints just that box.
  const armHighlightWatch = (rec, item) => {
    if (disposed || rec.blockUnwatch || typeof host?.watchBlock !== "function") return;
    const ref = item.target?.uid || item.uid;
    if (!ref) return;
    let pending = null;
    let latest = null;
    let off = null;
    const apply = () => {
      pending = null;
      if (disposed || rec.body?.isConnected === false) return;
      const kids = latest?.[":block/children"];
      if (!Array.isArray(kids)) return;
      const note = highlightNote(kids);
      if (note === rec.hlNote) return;
      rec.hlNote = note;
      if (rec.hlNoteBox) {
        for (const node of [...rec.hlNoteBox.children]) { try { host?.unmount?.(node); } catch { /* not mounted */ } }
        rec.hlNoteBox.remove();
        rec.hlNoteBox = null;
      }
      if (!note.trim()) return;
      const box = doc.createElement("div");
      box.className = "pxd-highlight-note";
      if (rec.hlFoot?.parentNode === rec.body) rec.body.insertBefore(box, rec.hlFoot);
      else rec.body.append(box);
      rec.hlNoteBox = box;
      const root = renderRoot(box, note, "pxd-rs", item.uid);
      if (!rec.roots) rec.roots = [];
      rec.roots.push(root);
    };
    try {
      off = host.watchBlock(ref, (after) => {
        latest = after;
        if (!pending) pending = later(apply, BLOCK_REFRESH_MS);
      });
    } catch { return; }
    if (typeof off !== "function") return;
    rec.blockUnwatch = () => {
      rec.blockUnwatch = null;
      try { off(); } catch { /* already off */ }
      pending?.();
      pending = null;
    };
  };
  // HEP-4. The chip follows a rename of the page's Author:: block. One shared watch per author block.
  const armAuthorWatch = (rec, chip, node) => {
    if (disposed || rec.authorUnwatch || typeof host?.watchBlock !== "function") return;
    const authorUid = authorBlockUid(pageChildrenOf(chip.pageUid));
    if (!authorUid) return;
    let off = null;
    try {
      off = host.watchBlock(authorUid, (after) => {
        const next = after?.[":block/string"];
        if (typeof next !== "string" || node.isConnected === false) return;
        const fresh = chipWithAuthor(chip, next);
        if (!fresh || node.textContent === fresh.text) return;
        node.textContent = fresh.text;
        node.setAttribute("aria-label", `Open ${fresh.text}`);
      });
    } catch { return; }
    if (typeof off !== "function") return;
    rec.authorUnwatch = () => {
      rec.authorUnwatch = null;
      try { off(); } catch { /* already off */ }
    };
  };
  const armBlockWatch = (rec, item) => {
    if (disposed || rec.blockUnwatch || typeof host?.watchBlock !== "function") return;
    const ref = item.target?.uid;
    if (!ref) return;
    checkBlockRefFresh(rec, item);
    let pending = null;
    let latest = null;
    let off = null;
    try {
      off = host.watchBlock(ref, (after) => {
        latest = after;
        if (pending) return;
        pending = later(() => {
          pending = null;
          refreshBlockRef(rec, item, latest);
        }, BLOCK_REFRESH_MS);
      });
    } catch { return; }
    if (typeof off !== "function") return;
    rec.blockUnwatch = () => {
      rec.blockUnwatch = null;
      try { off(); } catch { /* already off */ }
      pending?.();
      pending = null;
    };
  };

  const mountContentBody = (rec, item) => {
    startRows();
    noteRender(item.uid);
    rec.kidCount = 0;
    rec.kidRows = 0;
    const body = rec.body;
    if (rec.editor && editing?.uid !== item.uid) detachStickyEditor(rec);
    unmountRoots(rec);
    body.replaceChildren();
    rec.stickyLive = false;
    rec.editor = null;
    rec.bare = false;
    rec.el.classList.remove("pxd-item--bare");
    rec.el.classList.remove("pxd-item--roam-table");
    const budget = { n: 0, roots: [] };
    if (item.collapsed) {
      rec.contentKey = contentKeyFor(item);
      rec.roots = [];
      return;
    }
    if (isSticky(item)) {
      mountSticky(rec, item, budget);
    } else if (item.type === "text") {
      budget.roots.push(renderRoot(body, item.string, "pxd-rs pxd-item__text", item.uid));
    } else if (item.kind === "image") {
      budget.roots.push(renderRoot(el("div", "pxd-item__media", body), item.string, "pxd-rs", item.uid));
    } else if (item.kind === "board") {
      mountBoardBody(body, item);
    } else if (item.kind === "page") {
      if (item.open === false) {
        rec.roots = [];
        rec.contentKey = contentKeyFor(item);
        return;
      }
      const holder = el("div", "pxd-item__page", body);
      rec.pageHolder = holder;
      if (onPageLayout && !rec.scrollOff) {
        const onScroll = () => onPageLayout(rec.uid);
        body.addEventListener("scroll", onScroll, { passive: true });
        rec.scrollOff = () => body.removeEventListener("scroll", onScroll, { passive: true });
      }
      rec.pageTitle = item.title;
      const mountedAt = now();
      const preview = fetchPage(item.title);
      // contentKey is stamped after mountContent returns, so only the async path can be stale.
      const apply = (p, sync = false) => {
        if (disposed || !holder.parentElement || (!sync && rec.contentKey !== contentKeyFor(item))) return;
        const roots = paintPage(rec, holder, p);
        rec.mountStat = notePageMount(item.title, now() - mountedAt, rec.rowTable ? rec.rowTable.size : 0, outlineCache.get(item.title) === p);
        if (rec.mountStat) rec.mountStat.primed = rec.primed ?? null;
        if (sync) budget.roots.push(...roots);
        else rec.roots.push(...roots);
      };
      if (preview && typeof preview.then === "function") preview.then((p) => apply(p)).catch(() => {});
      else apply(preview, true);
      mountLinkedRefs(body, rec, item);
      armPageWatch(rec, item, holder);
    } else if (item.kind === "region-ref") {
      mountRegionBody(rec, item);
    } else if (item.kind === "drawing-ref") {
      mountDrawingBody(rec, item);
    } else if (item.kind === "pdf") {
      const cover = pdfCoverOf(item);
      rec.pdfCover = cover;
      if (editing?.uid !== item.uid && !rec.renaming) rec.header.textContent = String(cover.title || "PDF").slice(0, HEADER_TEXT_MAX);
      if (inlineUid === item.uid || (!onReadPane && (pdfReaderBox(item.uid) || speedOf().posters === false))) budget.roots.push(paintPdfReader(rec, item));
      else paintPdfCover(rec, item, cover);
    } else if (item.kind === "highlight" && item.highlight) {
      paintHighlight(rec, item, budget);
      armHighlightWatch(rec, item);
    } else if (item.kind === "block") {
      const ref = item.target.uid;
      const refString = host?.blockString?.(ref);
      const isBoardRef = typeof refString === "string" && classifyString(refString).kind === "board";
      if (isBoardRef) rec.refTitle = parseBoardTitle(refString) || "Untitled board";
      else if (typeof refString === "string" && isQueryString(refString)) rec.refTitle = "Query";
      else rec.refTitle = typeof refString === "string" ? firstLine(refString).slice(0, REF_TITLE_MAX) : "";
      const blockPoster = posterTitleOf(item);
      if (blockPoster) rec.refTitle = blockPoster;
      if (editing?.uid !== item.uid) rec.header.textContent = String(rec.refTitle || item.title || "").slice(0, HEADER_TEXT_MAX);
      if (isBoardRef) {
        if (item.open === false) {
          rec.roots = budget.roots;
          rec.contentKey = contentKeyFor(item);
          return;
        }
        // Whiteboard shortcut: the same thumbnail from the referenced board's children. Never renderString (a nested overlay).
        const pulled = host?.pullBoard?.(ref);
        mountBoardBody(body, {
          uid: ref,
          string: refString,
          content: pulled?.[":block/children"] ?? pulled?.children ?? [],
          w: item.w,
          h: item.h,
          title: rec.refTitle,
          enhanced: false,
        }, { openUid: ref });
      } else if (typeof refString === "string" && isQueryString(refString) && host?.renderBlock) {
        budget.roots.push(mountQuery(body, ref));
      } else if (isRoamTableString(refString)) {
        rec.el.classList.add("pxd-item--roam-table");
        mountTableHost(body, ref, budget);
        rec.kidCount = 0;
        rec.kidRows = 0;
      } else {
        rec.blockStringNode = null;
        if (typeof refString === "string" && refString.trim()) {
          const node = renderRoot(body, refString, "pxd-rs pxd-item__string", ref);
          rec.blockStringNode = node;
          budget.roots.push(node);
        }
        const tree = host?.pullTree?.(ref, item.kids ? CONTENT_DEPTH : 1, 200);
        const apply = (blocks, sync = false) => {
          if (disposed || !body.isConnected || (!sync && rec.contentKey !== contentKeyFor(item))) return;
          startRows();
          if (!refString?.trim() && !blocks?.length) el("div", "pxd-item__placeholder", body).textContent = "Empty card";
          rec.kidCount = visibleKids(blocks).length;
          rec.kidRows = kidRowsOf(blocks);
          if (item.kids) {
            const b = { n: 0, roots: [] };
            renderBlocks(body, blocks || [], 1, b);
            if (sync) budget.roots.push(...b.roots);
            else rec.roots.push(...b.roots);
          }
          if (!sync) syncKidsBadge(rec, item);
          if (!body.querySelector?.(".pxd-chip--source")) {
            const chip = sourceChipOf(item);
            if (chip) {
              const node = buildSourceChip(doc, chip, {
                onOpen: (uid) => { try { host?.openInSidebar?.(uid); } catch { /* host */ } },
              });
              if (node) {
                body.append(node);
                armAuthorWatch(rec, chip, node);
              }
            }
          }
        };
        if (tree && typeof tree.then === "function") tree.then((t) => apply(t)).catch(() => {});
        else apply(tree, true);
        armBlockWatch(rec, item);
      }
    } else if (isQueryString(item.string) && host?.renderBlock) {
      budget.roots.push(mountQuery(body, item.uid));
    } else if (isRoamTableString(item.string)) {
      rec.el.classList.add("pxd-item--roam-table");
      mountTableHost(body, item.uid, budget);
      rec.kidCount = 0;
      rec.kidRows = 0;
    } else {
      if (item.string?.trim()) budget.roots.push(taskBlockOn(item) ? mountTaskLine(body, item) : renderRoot(body, item.string, "pxd-rs pxd-item__string", item.uid));
      rec.kidCount = visibleKids(item.content).length;
      rec.kidRows = kidRowsOf(item.content);
      if (item.kids) renderBlocks(body, item.content || [], 1, budget);
      if (!item.string?.trim() && !(item.content || []).length) {
        el("div", "pxd-item__placeholder", body).textContent = "Empty card";
      }
    }
    rec.roots = budget.roots;
    rec.contentKey = contentKeyFor(item, rec.stickyLive);
  };

  const regionWindow = () => doc.defaultView || globalThis;
  const roamPlexus = () => {
    const api = regionWindow().RoamPlexus ?? globalThis.RoamPlexus;
    return api && typeof api === "object" ? api : null;
  };
  const drawingEditorMounted = (drawingUid) => {
    if (!drawingUid) return false;
    // Roam ids read block-input-<window>-body-outline-<page>-<uid>.
    const suffix = `-${drawingUid}`;
    for (const root of doc.querySelectorAll?.('[id^="block-input-"]') || []) {
      if (String(root.id || "").endsWith(suffix) && root.querySelector?.(".excalidraw")) return true;
    }
    return false;
  };
  const blobOf = async (value) => {
    if (value == null) return null;
    if (typeof value?.then === "function") return blobOf(await value);
    if (typeof value === "string") return value.length ? value : null;
    if (typeof value === "object") return value;
    return null;
  };
  const canvasBlob = (canvas) => new Promise((resolve) => {
    if (!canvas || typeof canvas.toBlob !== "function") { resolve(null); return; }
    try { canvas.toBlob((blob) => resolve(blob || null), "image/png"); } catch { resolve(null); }
  });
  const snapshots = new Set(); // { holder, mount, stop, done } while a fallback thumbnail renders
  const waitDrawingImg = (holder, snap) => new Promise((resolve) => {
    const start = Date.now();
    snap.done = () => resolve(null);
    const tick = () => {
      if (disposed) { resolve(null); return; }
      const img = holder.querySelector?.("img.rm-inline-img.rm-inline-img--excalidraw");
      if (img && (img.complete || img.naturalWidth > 0)) { resolve(img); return; }
      if (Date.now() - start > 2500) { resolve(img || null); return; }
      snap.stop = later(tick, 40);
    };
    tick();
  });
  const dropSnapshot = (snap) => {
    snap.stop?.();
    snap.stop = null;
    snap.done?.();
    try { host?.unmount?.(snap.mount); } catch { /* nothing mounted */ }
    snap.holder.remove?.();
    snapshots.delete(snap);
  };
  const snapshotDrawing = async (drawingUid) => {
    const root = boardRoot();
    if (!host?.renderBlock || !doc.createElement || !root || disposed) return null;
    const holder = doc.createElement("div");
    holder.className = "pxd-snap-holder";
    holder.setAttribute?.("aria-hidden", "true");
    const mount = doc.createElement("div");
    holder.append(mount);
    root.append(holder);
    const snap = { holder, mount, stop: null, done: null };
    snapshots.add(snap);
    try { host.renderBlock(mount, drawingUid, { open: false }); } catch { /* no render */ }
    const img = await waitDrawingImg(mount, snap);
    let blob = null;
    if (img && !disposed) blob = await canvasBlob(copyDrawingPixels(img, doc));
    dropSnapshot(snap);
    return blob;
  };
  const loadDrawingBlob = async (api, drawingUid) => {
    if (interopAllowed() && api && Number(api.apiVersion) >= 6 && typeof api.thumbnail === "function") {
      let shot = null;
      try { shot = await blobOf(api.thumbnail(drawingUid, { maxWidth: 160 })); } catch { shot = null; }
      if (shot == null) {
        try { shot = await blobOf(api.thumbnail(drawingUid, { maxWidth: 160, render: true })); } catch { shot = null; }
      }
      return shot;
    }
    return snapshotDrawing(drawingUid);
  };
  const mountDrawingBody = (rec, item) => {
    const ref = item.target?.uid;
    const api = roamPlexus();
    const off = rec.el.classList.contains("pxd-item--offscreen");
    const detail = lod === "detail" && !off;
    let regions;
    if (api && typeof api.regionsOf === "function" && ref) {
      try {
        const rows = api.regionsOf(ref);
        regions = Array.isArray(rows) ? rows : [];
      } catch { regions = []; }
    }
    const token = {};
    rec.drawingToken = token;
    const paint = (blob) => {
      if (disposed || rec.drawingToken !== token || !rec.body?.isConnected) return;
      rec.drawingNode = renderDrawingCard(doc, rec.body, { title: item.title || "Drawing" }, {
        tier: lod,
        visible: detail,
        blob: detail ? blob : undefined,
        regions,
        open: ({ sidebar } = {}) => {
          const live = roamPlexus();
          if (live && typeof live.open === "function") {
            if (drawingEditorMounted(ref)) return;
            try { live.open(ref, { sidebar: Boolean(sidebar) }); } catch { /* host */ }
            return;
          }
          try { host?.openBlock?.(ref); } catch { /* host */ }
          try { onToast?.("the expand control is Roam's"); } catch { /* toast */ }
        },
        addRegion: (regionUid) => {
          if (!regionUid || typeof session?.addPublicCard !== "function") return;
          try { session.addPublicCard({ string: `((${regionUid}))` }); } catch { /* one write */ }
        },
      });
    };
    paint(null);
    if (!detail || !ref) return;
    void loadDrawingBlob(api, ref).then((blob) => { if (blob) paint(blob); }).catch(() => {});
  };
  const mountRegionBody = (rec, item) => {
    const api = regionWindow().RoamPlexus ?? null;
    const ref = item.target?.uid;
    let text = "";
    try { text = ref ? host?.blockString?.(ref) || "" : ""; } catch { text = ""; }
    const model = regionRefModel(text, api);
    const caption = model?.caption ?? item.title ?? "";
    if (model?.drawingUid) item.regionDrawing = model.drawingUid;
    const off = rec.el.classList.contains("pxd-item--offscreen");
    const detail = lod === "detail" && !off;
    rec.regionNode = renderRegionCard(doc, rec.body, { caption }, {
      tier: lod,
      visible: detail,
      maxWidth: Math.max(1, Math.round(Number(rec.rect?.w || item.w) || 160)),
      thumbnail: detail ? (opts) => {
        if (!interopAllowed()) return null;
        if (lod !== "detail" || rec.el.classList.contains("pxd-item--offscreen")) return null;
        const live = regionWindow().RoamPlexus;
        if (!ref || typeof live?.thumbnail !== "function") return null;
        return live.thumbnail(ref, { maxWidth: opts?.maxWidth });
      } : undefined,
      open: ({ sidebar } = {}) => {
        const live = regionWindow().RoamPlexus;
        if (!ref || typeof live?.open !== "function") return;
        try { live.open(ref, { region: true, sidebar: Boolean(sidebar) }); } catch { /* host */ }
      },
    });
    if (detail) rec.regionWidth = rec.rect?.w ?? item.w;
  };

  const mountContent = (rec, item) => {
    reserveCardHeight(rec, item);
    mountContentBody(rec, item);
    syncKidsBadge(rec, item);
  };

  const mountSectionTitle = (rec, item) => {
    noteRender(item.uid);
    unmountRoots(rec);
    rec.title.replaceChildren();
    const node = renderRoot(rec.title, item.string || "Section", "pxd-rs pxd-section__title-text", item.uid);
    if (!item.string) node.textContent = "Section";
    rec.roots = [node];
    rec.titleRendered = true;
    rec.contentKey = contentKeyFor(item);
  };

  const unmountContent = (uid) => {
    const rec = shells.get(uid);
    if (!rec || editing?.uid === uid) return;
    unmountRoots(rec);
    if (rec.type === "section") {
      rec.title.replaceChildren();
      rec.title.textContent = lastBoard?.items.get(uid)?.title || "Section";
      rec.titleRendered = false;
    } else {
      rec.body?.replaceChildren?.();
      dropKidsBadge(rec);
      if (rec.type === "card") { rec.bare = true; rec.el.classList.add("pxd-item--bare"); }
      onPageLayout?.(uid);
    }
    rec.contentKey = null;
    mounted.delete(uid);
    contentSched?.drop(uid);
  };

  // One card body is one scheduler row. Already mounted bodies return done so renderBlock is not called again.
  const mountScheduled = (uid) => {
    if (disposed || paused) return false;
    if (!wanted.has(uid)) return false;
    if (mounted.has(uid)) return true;
    const rec = shells.get(uid);
    const item = lastBoard?.items.get(uid);
    if (!rec || !item || editing?.uid === uid) return true;
    if (rec.type === "section") mountSectionTitle(rec, item);
    else mountContent(rec, item);
    mounted.delete(uid);
    mounted.set(uid, now());
    evict();
    return true;
  };
  contentSched = createRowScheduler({
    idle: (fn) => idle(fn),
    now,
    budgetMs: CHUNK_MS,
    render: (uid) => mountScheduled(uid),
    eager: () => speedOf().budgetedMount === false,
  });
  const publishMountFps = () => {
    const fps = mountFpsFromStamps(frameStamps);
    if (fps == null) return;
    const bag = host?.stats;
    if (!bag || typeof bag !== "object") return;
    bag.mountFps = fps;
  };
  const stopFrames = () => {
    if (typeof frameSample === "function") frameSample();
    frameSample = null;
  };
  // rAF stamps while card bodies are still pending. speed-log stays off; the number lives on host.stats.
  const armFrames = () => {
    if (frameSample || disposed || typeof timers?.frame !== "function") return;
    if (!contentSched.pending()) return;
    frameSample = timers.frame((t) => {
      frameSample = null;
      if (disposed) return;
      frameStamps.push(Number.isFinite(t) ? t : now());
      publishMountFps();
      if (contentSched.pending() > 0) armFrames();
    });
  };

  const evict = () => {
    if (mounted.size <= LRU_CAP) return;
    const victims = [];
    for (const uid of mounted.keys()) {
      if (mounted.size - victims.length <= LRU_CAP) break;
      if (!wanted.has(uid)) victims.push(uid);
    }
    for (const uid of mounted.keys()) {
      if (mounted.size - victims.length <= LRU_CAP) break;
      if (!victims.includes(uid)) victims.push(uid);
    }
    victims.forEach(unmountContent);
  };

  let unmountTimer = null;
  const scheduleUnmounts = () => {
    if (unmountTimer) return;
    unmountTimer = later(() => {
      unmountTimer = null;
      if (disposed) return;
      const t = now();
      for (const [uid, seen] of [...mounted]) {
        if (!wanted.has(uid) && unmountDue(seen, t, UNMOUNT_AFTER_MS - 1)) unmountContent(uid);
      }
      if ([...mounted.keys()].some((u) => !wanted.has(u))) scheduleUnmounts();
    }, UNMOUNT_AFTER_MS);
  };

  // Decide which items need content for the current viewport; mount in idle chunks.
  // `quieted` drops every live Roam root while the user types outside the board.
  // A keystroke is a Roam transaction, and each renderString root re-renders on it.
  let lastContent = null;
  let quieted = false;
  const holdQuiet = (rec, uid) => {
    if (!rec.roots?.length || editing?.uid === uid) return;
    if (rec.type === "section") {
      const text = rec.title?.textContent || lastBoard?.items.get(uid)?.title || "Section";
      unmountRoots(rec);
      if (rec.title) rec.title.textContent = text;
      rec.titleRendered = false;
    } else if (rec.body) {
      const text = rec.body.textContent || "";
      unmountRoots(rec);
      rec.body.replaceChildren();
      if (text) el("div", "pxd-quiet", rec.body).textContent = text;
    } else {
      unmountRoots(rec);
    }
    rec.contentKey = null;
    mounted.delete(uid);
    contentSched?.drop(uid);
  };
  const cardHeavy = (item, rec) => {
    if (!item || item.type === "section") return false;
    if (isHeavyRow(item.string) || isHeavyRow(rec?.refString)) return true;
    return item.kind === "image" || item.kind === "pdf" || item.kind === "board" || item.kind === "drawing-ref";
  };
  const centreDist = (uid, visibleRect) => {
    const r = drawnRect(uid, lastRects?.get(uid));
    if (!r || !visibleRect) return 0;
    const cx = (Number(visibleRect.x) || 0) + (Number(visibleRect.w) || 0) / 2;
    const cy = (Number(visibleRect.y) || 0) + (Number(visibleRect.h) || 0) / 2;
    const dx = (Number(r.x) || 0) + (Number(r.w) || 0) / 2 - cx;
    const dy = (Number(r.y) || 0) + (Number(r.h) || 0) / 2 - cy;
    return dx * dx + dy * dy;
  };
  // PERF-3. Keep this call at the start of fillContent. An editing card is never a shell.
  const cssVar = (style, name) => (typeof style.getPropertyValue === "function" ? style.getPropertyValue(name) : style[name]) || "";
  // A later pass (gesture resume) must not rewrite a shell that is already right.
  const paintOffscreen = (visibleRect) => {
    for (const [uid, rec] of shells) {
      if (!rec.el || rec.type === "section") continue;
      const rect = drawnRect(uid, lastRects?.get(uid));
      const off = Boolean(visibleRect) && shellOffscreen(uid, rect, visibleRect, { editingUid: editing?.uid ?? null });
      if (rec.el.classList.contains("pxd-item--offscreen") !== off) {
        rec.el.classList.toggle("pxd-item--offscreen", off);
      }
      if (!off) {
        if (cssVar(rec.el.style, "--pxd-iw")) rec.el.style.removeProperty("--pxd-iw");
        if (cssVar(rec.el.style, "--pxd-ih")) rec.el.style.removeProperty("--pxd-ih");
        const item = lastBoard?.items.get(uid);
        if (!paused && item?.kind === "region-ref" && lod === "detail" && mounted.has(uid) && editing?.uid !== uid && thumbRequest(rec.regionWidth, rec.rect?.w)) {
          mountContent(rec, item);
        }
        continue;
      }
      const [iw, ih] = intrinsicSize(rect).split(" ");
      if (cssVar(rec.el.style, "--pxd-iw") !== iw) rec.el.style.setProperty("--pxd-iw", iw);
      if (cssVar(rec.el.style, "--pxd-ih") !== ih) rec.el.style.setProperty("--pxd-ih", ih);
    }
  };
  const fillContent = ({ visibleRect, zoom = zoomCache, tier = null, dirty = null } = {}) => {
    zoomCache = zoom;
    syncTableZoom(zoomCache);
    paintOffscreen(visibleRect);
    if (!lastBoard || !lastRects || !contentSched) return;
    const next = new Set();
    if ((tier ?? lodForZoom(zoom)) === "detail") {
      for (const [uid, rec] of shells) {
        const r = drawnRect(uid, lastRects.get(uid));
        if (r && rectsIntersect(r, visibleRect)) next.add(uid);
      }
    } else {
      // map / overview LOD: section titles, text items and board thumbnails, including whiteboard-shortcut cards (plain divs) stay rendered; card bodies unmount later
      for (const [uid, rec] of shells) {
        const r = drawnRect(uid, lastRects.get(uid));
        const kind = lastBoard.items.get(uid)?.kind;
        const keep = rec.type === "section" || rec.type === "text" || rec.refBoard || rec.regionImg || kind === "board" || kind === "image" || kind === "pdf" || kind === "highlight";
        if (keep && r && rectsIntersect(r, visibleRect)) next.add(uid);
      }
    }
    wanted = next;
    const t = now();
    for (const uid of next) if (mounted.has(uid)) mounted.set(uid, t);
    for (const uid of shells.keys()) if (!next.has(uid)) contentSched.want(uid, false);
    // null dirty is the first open: every visible body mounts once. A later diff remounts only its uids.
    const dirtyKnown = dirty != null && typeof dirty.has === "function";
    for (const uid of next) {
      const rec = shells.get(uid);
      const item = lastBoard.items.get(uid);
      if (!rec || !item) continue;
      const heavy = cardHeavy(item, rec);
      const near = centreDist(uid, visibleRect);
      if (contentSched.isDone(uid)) {
        if (mounted.has(uid)) continue;
        if (dirtyKnown && !dirty.has(uid)) continue;
        contentSched.reopen(uid, { heavy, near, wanted: true });
        continue;
      }
      contentSched.place(uid, { heavy, near, wanted: true });
    }
    if (!paused && contentSched.pending() > 0) armFrames();
    if ([...mounted.keys()].some((u) => !next.has(u))) scheduleUnmounts();
  };
  const scheduleContent = (args) => {
    lastContent = args;
    if (quieted) return;
    fillContent(args);
  };
  // Detach live Roam roots so a keystroke elsewhere does not re-render every card.
  // The words stay as plain text. The next schedule puts the live roots back.
  const quiet = (on) => {
    const next = Boolean(on);
    if (next === quieted) return;
    quieted = next;
    if (quieted) {
      contentSched?.hold(true);
      for (const [uid, rec] of shells) holdQuiet(rec, uid);
      return;
    }
    contentSched?.hold(false);
    if (lastContent) fillContent(lastContent);
  };

  const setPaused = (on) => {
    const was = paused;
    paused = Boolean(on);
    contentSched?.hold(paused);
    if (was && !paused && lod === "detail") {
      for (const [uid, rec] of shells) {
        const item = lastBoard?.items.get(uid);
        if (item?.kind !== "region-ref" || editing?.uid === uid || !mounted.has(uid)) continue;
        if (rec.el.classList.contains("pxd-item--offscreen")) continue;
        if (!thumbRequest(rec.regionWidth, rec.rect?.w)) continue;
        mountContent(rec, item);
      }
    }
  };

  const setZoom = (zoom) => {
    const next = Number(zoom);
    const prevZoom = zoomCache;
    zoomCache = next > 0 && Number.isFinite(next) ? next : 1;
    if (zoomCache !== prevZoom) closePeek();
    if (editing?.editor) scaleCardEditor(editing.editor, zoomCache);
    if (zoomCache !== prevZoom) for (const rec of shells.values()) if (rec.stickyLive && rec.editor && rec.editor !== editing?.editor) applyEditorCounterScale(rec.editor, zoomCache);
    syncTableZoom(zoomCache);
  };

  const setLod = (nextLod, zoom) => {
    const prev = lod;
    lod = nextLod === "map" || nextLod === "overview" ? nextLod : "detail";
    setZoom(zoom);
    closePeek();
    if ((prev === "detail") !== (lod === "detail")) {
      // EK-2: a sticky is the live block at detail zoom and a static render below it.
      // A pdf reader is detail-only. Map lod paints the cover at the card's own size.
      let moved = false;
      for (const [uid, rec] of shells) {
        const item = lastBoard?.items.get(uid);
        if (rec.type === "text" && rec.contentKey && editing?.uid !== uid && isSticky(item)) {
          unmountContent(uid);
          moved = true;
        } else if (item?.kind === "pdf" && mounted.has(uid) && editing?.uid !== uid) {
          unmountContent(uid);
          applyPdfSize(rec);
          moved = true;
        } else if (item?.kind === "highlight" && mounted.has(uid) && editing?.uid !== uid) {
          unmountContent(uid);
          moved = true;
        } else if (item && item.kind !== "pdf" && ownsOpen(item) && mounted.has(uid) && editing?.uid !== uid) {
          unmountContent(uid);
          moved = true;
        }
      }
      if (moved && lastContent && !quieted) fillContent({ ...lastContent, tier: lod, zoom: zoomCache });
    }
    if (prev !== lod) for (const rec of shells.values()) if (rec.kidsBtn || rec.kidCount > 0) syncKidsBadge(rec);
    if (showBadges && (prev === "detail") !== (lod === "detail")) {
      if (lod !== "detail") {
        const pending = [];
        for (const rec of shells.values()) if (rec.badgeEl) pending.push(rec);
        const step = () => {
          for (const rec of pending.splice(0, 40)) {
            rec.badgeEl.remove();
            rec.badgeEl = null;
            rec.badgeKey = null;
          }
          if (pending.length) {
            if (timers?.frame) timers.frame(step);
            else step();
          }
        };
        // The class flip is the frame the zoom crossed. Badge removal waits for the
        // next frame when a frame timer exists, so the two do not share one long task.
        if (timers?.frame) timers.frame(step);
        else step();
      } else {
        for (const rec of shells.values()) renderBadges(rec);
      }
    }
  };

  // ---------------------------------------------------------------- preview during gestures
  const previewMove = (uids, dx, dy, board, rects) => {
    const set = new Set(uids);
    for (const u of uids) for (const d of descendantsOf(board, u)) set.add(d);
    const live = new Map();
    for (const uid of set) {
      const rec = shells.get(uid);
      const r = rects.get(uid);
      if (!rec || !r) continue;
      const moved = { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h };
      rec.el.style.transform = `translate(${moved.x}px, ${moved.y}px)`;
      live.set(uid, moved);
    }
    return live;
  };
  const previewRects = (list) => {
    const live = new Map();
    for (const r of list) {
      const rec = shells.get(r.uid);
      if (!rec) continue;
      position(rec, { x: r.x, y: r.y, w: r.w, h: r.h });
      live.set(r.uid, { x: r.x, y: r.y, w: r.w, h: r.h });
    }
    return live;
  };

  // Sections only: live auto-fit growth during a drag positions section shells and nothing else.
  const previewSectionRects = (list) => {
    const live = new Map();
    for (const r of list || []) {
      const rec = shells.get(r.uid);
      if (!rec || rec.type !== "section") continue;
      position(rec, { x: r.x, y: r.y, w: r.w, h: r.h });
      live.set(r.uid, { x: r.x, y: r.y, w: r.w, h: r.h });
    }
    return live;
  };
  // Snap shells back to the model rects (a cancelled or refused gesture).
  const resetRects = (rectsMap, uids = null) => {
    for (const uid of uids ? [...uids] : [...shells.keys()]) {
      const rec = shells.get(uid);
      const r = rectsMap?.get?.(uid);
      if (rec && r) position(rec, { x: r.x, y: r.y, w: r.w, h: r.h });
    }
  };
  // World-unit height of a mounted card's header plus body content; null when there is nothing to measure.
  const measureContent = (uid) => {
    const rec = shells.get(uid);
    if (!rec || rec.type === "section" || lod !== "detail" || !mounted.has(uid) || rec.bare) return null;
    // The body is a flex child of a fixed-height card, so its scrollHeight is clamped to the box. Let it take its
    // natural height for the read (a one-off user action), then put the inline styles back.
    const body = rec.body;
    const st = body?.style;
    const saved = st ? { flex: st.flex, height: st.height } : null;
    if (st) { st.flex = "0 0 auto"; st.height = "auto"; }
    const natural = Number(body?.scrollHeight) || 0;
    if (st && saved) { st.flex = saved.flex; st.height = saved.height; }
    const h = (Number(rec.header?.offsetHeight) || 0) + natural;
    return h > 0 ? h : null;
  };

  // ---------------------------------------------------------------- badges and focus (read-only, never touch the model)
  const attrChipsOf = (rec, item) => {
    if (item.kind === "board") return [];
    const lines = [];
    const own = item.kind === "block" ? rec.refString : item.string;
    if (typeof own === "string") lines.push(...own.split("\n"));
    for (const c of item.content || []) lines.push(...String(childString(c)).split("\n"));
    const out = [];
    for (const line of lines) {
      if (out.length >= ATTR_CHIPS_MAX) break;
      const name = attrNameOf(line);
      if (!name || skipChildString(line)) continue;
      const value = plainText(line.slice(line.indexOf("::") + 2), 40);
      if (value) out.push(`${plainText(name, 24)}: ${value}`);
    }
    return out;
  };

  // Task chips: due, project, priority, repeat, status, waiting-for and GTD. Clicking one opens its popover when
  // Better Tasks can write it; without Better Tasks they are plain read-only marks.
  const taskChipsOf = (task) => {
    const edit = Boolean(bt?.available?.()) && typeof onTaskChip === "function";
    const note = edit ? " Click to change. Changes go through Better Tasks, so Cmd+Z there is Roam's undo." : "";
    const out = [];
    if (task.due) {
      out.push({ cls: "due", text: task.due.short, title: `Due ${task.due.text}.${note}`, overdue: task.due.overdue, today: task.due.today, task: edit ? "due" : null });
    } else if (edit && taskChips === "full" && !task.done) {
      out.push({ cls: "due", text: "+ Due", title: `Set a due date.${note}`, empty: true, task: "due" });
    }
    if (taskChips !== "full") return out;
    if (task.project) out.push({ cls: "project", text: task.project, title: `Project ${task.project}.${note}`, task: edit ? "project" : null });
    if (task.priorityGlyph) out.push({ cls: "priority", text: task.priorityGlyph, title: `Priority ${task.priority}.${note}`, task: edit ? "priority" : null });
    if (task.repeat) out.push({ cls: "repeat", text: "\u21BB", title: `Repeats: ${task.repeat}.${note}`, task: edit ? "repeat" : null });
    if (task.status) out.push({ cls: "status", text: task.status, title: `Status ${task.status}` });
    if (task.waitingFor) out.push({ cls: "waiting", text: task.waitingFor, title: `Waiting for ${task.waitingFor}` });
    if (task.gtd) out.push({ cls: "gtd", text: task.gtd, title: `GTD ${task.gtd}` });
    return out;
  };

  const renderBadges = (rec) => {
    const item = lastBoard?.items.get(rec.uid);
    const visible = showBadges && lod === "detail" && rec.type === "card" && item && editing?.uid !== rec.uid;
    const clear = () => { if (rec.badgeEl) { rec.badgeEl.remove(); rec.badgeEl = null; } rec.badgeKey = null; };
    if (!visible) return clear();
    const info = badgeMap?.get?.(rec.uid) || null;
    const chips = [];
    if (info?.refs > 0) chips.push({ cls: "refs", text: `${info.refs} refs`, title: `${info.refs} references to this card` });
    const regionCount = imageRegionRows(item.content).length;
    if (regionCount > 0) chips.push({ cls: "regions", text: regionBadge(regionCount), title: `${regionCount} ${regionCount === 1 ? "region" : "regions"}` });
    if (info?.boards > 0) chips.push({ cls: "boards", text: `on ${info.boards} boards`, title: "Shown on other boards", action: "boards" });
    if (info && (info.open > 0 || info.done > 0)) chips.push({ cls: "todo", text: `${info.open || 0}/${info.done || 0}`, title: `${info.open || 0} open, ${info.done || 0} done` });
    const comments = commentCount(lastBoard, rec.uid);
    if (comments > 0) chips.push({ cls: "comments", text: `${comments}`, title: `${comments} comments` });
    const task = isTaskCard(item) ? taskMeta(item.string, item.content) : null;
    if (task) {
      if (taskChips !== "none") chips.unshift(...taskChipsOf(task));
    } else {
      const due = item.type === "card" ? dueChip(item.content) : null;
      if (due) chips.unshift({ cls: "due", text: due.text, title: "Due", overdue: due.overdue });
    }
    for (const text of attrChipsOf(rec, item)) chips.push({ cls: "attr", text });
    if (!chips.length) return clear();
    const key = JSON.stringify(chips);
    if (rec.badgeEl && rec.badgeKey === key) return;
    clear();
    const row = el("div", "pxd-item__badges", rec.el);
    for (const chip of chips) {
      const node = el(chip.action || chip.task ? "button" : "span", `pxd-badge-chip pxd-badge-chip--${chip.cls}`, row);
      node.textContent = chip.text;
      if (chip.overdue) node.classList.add("pxd-badge-chip--overdue");
      if (chip.today) node.classList.add("pxd-badge-chip--today");
      if (chip.empty) node.classList.add("pxd-badge-chip--empty");
      if (chip.task) {
        node.type = "button";
        node.setAttribute("aria-label", chip.title || chip.text);
        node.setAttribute("data-task-chip", chip.task);
        for (const type of ["pointerdown", "mousedown", "dblclick"]) node.addEventListener(type, stopEvent);
        node.addEventListener("click", (event) => { event.stopPropagation(); onTaskChip?.(rec.uid, chip.task, node); });
      }
      if (chip.title) node.title = chip.title;
      if (chip.action) {
        node.type = "button";
        node.setAttribute("aria-label", chip.title || chip.text);
        for (const type of ["pointerdown", "mousedown", "dblclick"]) node.addEventListener(type, stopEvent);
        node.addEventListener("click", (event) => { event.stopPropagation(); onBadgeClick?.(rec.uid, chip.action); });
      }
    }
    rec.badgeEl = row;
    rec.badgeKey = key;
  };

  const setBadges = (map) => {
    badgeMap = map instanceof Map ? map : new Map();
    if (showBadges) for (const rec of shells.values()) renderBadges(rec);
  };
  // The Task Status Tags list changed (ready, unload, rename, recolour): rebuild the palette and repaint tasks.
  const refreshStatuses = () => {
    statusPal = null;
    statusSig = paletteEntries(palette()).map((row) => `${row.name}:${row.glyph}:${row.light?.base}:${row.dark?.base}`).join("|");
    for (const rec of shells.values()) renderBadges(rec);
    if (!lastBoard) return;
    // Task cards whose content key changed are cleared by the sync; the content pass mounts them again.
    const tasks = new Set();
    for (const [uid, item] of lastBoard.items) if (isTaskCard(item)) tasks.add(uid);
    sync({ board: lastBoard, rects: lastRects, dirty: tasks });
    if (lastContent) scheduleContent({ ...lastContent, dirty: tasks });
  };
  const setTaskChips = (mode) => {
    const next = ["full", "due only", "none"].includes(mode) ? mode : "full";
    if (next === taskChips) return;
    taskChips = next;
    for (const rec of shells.values()) renderBadges(rec);
  };
  const setShowBadges = (on) => {
    const next = Boolean(on);
    if (next === showBadges) return;
    showBadges = next;
    for (const rec of shells.values()) renderBadges(rec);
  };
  let trailBadgeSig = "";
  const setTrailBadges = (map) => {
    const next = map instanceof Map ? map : new Map();
    let sig = "";
    if (next.size) {
      const parts = [];
      for (const [k, v] of next) parts.push(`${k}=${v}`);
      sig = parts.join("|");
    }
    if (sig === trailBadgeSig) return;
    trailBadgeSig = sig;
    trailBadgeMap = next;
    for (const [uid, rec] of shells) {
      if (next.has(uid) || rec.trailBadge) paintTrailBadge(rec, uid);
    }
  };

  const setFocus = (uids) => {
    focusSet = uids ? new Set(uids) : null;
    for (const [uid, rec] of shells) {
      const on = Boolean(focusSet && !focusSet.has(uid));
      if (rec.focusDim === on) continue;
      rec.focusDim = on;
      rec.el.classList.toggle(rec.type === "section" ? "pxd-section--focus-dim" : "pxd-item--focus-dim", on);
    }
    if (!focusSet) return;
    const selected = selectedPrimary ? lastBoard?.items.get(selectedPrimary) : null;
    if (selected && focusSet.has(selectedPrimary)) {
      const heavy = ownHeavyUid(selected);
      if (heavy) openEmbed(heavy, { implicit: true });
      return;
    }
    const heavies = [];
    for (const uid of focusSet) {
      const heavy = ownHeavyUid(lastBoard?.items.get(uid));
      if (heavy) heavies.push(heavy);
    }
    if (heavies.length === 1) openEmbed(heavies[0], { implicit: true });
  };

  const setSelection = (uids) => {
    const list = Array.isArray(uids) ? uids : [];
    const set = new Set(list);
    let primary = null;
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (shells.has(list[i])) { primary = list[i]; break; }
    }
    for (const [uid, rec] of shells) {
      const on = set.has(uid);
      // A new shell leaves selected unset. That is not selected, so the first pass
      // writes only the card that turned on.
      if (Boolean(rec.selected) !== on) {
        rec.selected = on;
        rec.el.classList.toggle(rec.type === "section" ? "pxd-section--selected" : "pxd-item--selected", on);
      }
      const tab = uid === primary ? 0 : -1;
      if (rec.tabStop !== tab) {
        rec.tabStop = tab;
        rec.el.tabIndex = tab;
      }
    }
    if (primary === selectedPrimary) return;
    selectedPrimary = primary;
    if (!primary) return;
    const heavy = ownHeavyUid(lastBoard?.items.get(primary));
    if (heavy) openEmbed(heavy, { implicit: true });
  };
  const setHover = (uid) => {
    for (const [u, rec] of shells) {
      const on = u === uid;
      // Unset hover is not hovered. Clearing hover must not touch every shell.
      if (Boolean(rec.hover) === on) continue;
      rec.hover = on;
      rec.el.classList.toggle("pxd-item--drop", on);
    }
  };

  // ---------------------------------------------------------------- edit mode
  const onFocusSteal = (event) => {
    if (!editing) return;
    const target = event.target;
    if (!target || editing.editor.contains?.(target)) return;
    const isInput = target.classList?.contains?.("rm-block__input") || String(target.tagName || "").toLowerCase() === "textarea";
    if (!isInput) return;
    const hostEl = typeof target.closest === "function" ? target.closest("[data-uid]") : null;
    const uid = hostEl?.dataset?.uid || String(target.id || "").match(/([A-Za-z0-9_-]{9})$/)?.[1];
    if (uid !== editing.targetUid) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    event.stopImmediatePropagation?.();
  };
  const onDocPointerDown = (event) => {
    if (!editing) return;
    if (editing.rec.el.contains?.(event.target)) return;
    lastOutsideDown = now();
  };
  const attachFocusGuard = () => {
    if (focusGuard || typeof doc.addEventListener !== "function") return;
    doc.addEventListener("focus", onFocusSteal, true);
    doc.addEventListener("scroll", onFocusSteal, true);
    doc.addEventListener("pointerdown", onDocPointerDown, true);
    focusGuard = () => {
      doc.removeEventListener("focus", onFocusSteal, true);
      doc.removeEventListener("scroll", onFocusSteal, true);
      doc.removeEventListener("pointerdown", onDocPointerDown, true);
    };
  };
  const detachFocusGuard = () => {
    floorTeardown?.();
    floorTeardown = null;
    focusGuard?.();
    focusGuard = null;
  };

  // Focus floor: when Roam drops focus to <body> mid-edit (Enter creating a child block), refocus its live textarea.
  // Never writes to the graph (rule 19.2) and stands down for any real pointer or focus target outside the editor.
  const FLOOR_WINDOW_MS = 600;
  const FLOOR_POINTER_MS = 300;
  const FLOOR_MAX = 4;
  const FLOOR_SPAN_MS = 1500;
  const frameLater = (fn) => {
    if (timers?.frame) return timers.frame(fn);
    const raf = globalThis.requestAnimationFrame;
    if (typeof raf === "function") { const id = raf(fn); return () => globalThis.cancelAnimationFrame?.(id); }
    const t = setTimeout(fn, 16);
    return () => clearTimeout(t);
  };
  const rootOfLayer = () => itemsLayer?.closest?.(".pxd-root") ?? null;
  const focusLost = (a) => !a || a === doc.body || a === doc.documentElement || a === rootOfLayer();
  const findLiveTextarea = (e) => {
    const list = [...(e.editor.querySelectorAll?.("textarea") || [])];
    if (!list.length) return null;
    const ta = [...list].reverse().find((n) => String(n.id || "").startsWith("block-input-")) || list[list.length - 1];
    return ta?.isConnected ? ta : null;
  };
  const floorTick = (e) => {
    const f = floor;
    if (!f) return;
    f.cancel = null;
    const stop = () => { if (floor === f) floor = null; };
    if (editing !== e || disposed || lastOutsideDown > f.start - FLOOR_POINTER_MS || doc.hasFocus?.() === false) return stop();
    const a = doc.activeElement;
    if (e.editor.contains?.(a)) return stop();
    if (!focusLost(a)) return stop();
    const ta = findLiveTextarea(e);
    if (ta) { recoveries.push(now()); focusRoamInput(ta); return stop(); }
    if (now() - f.start < FLOOR_WINDOW_MS) f.cancel = frameLater(() => floorTick(e));
    else stop();
  };
  const armFloor = () => {
    const e = editing;
    if (!e || disposed || !e.ready || floor) return false;
    const t = now();
    recoveries = recoveries.filter((x) => t - x < FLOOR_SPAN_MS);
    if (recoveries.length >= FLOOR_MAX) {
      // The cap only rate-limits a focus ping-pong with Roam; it must not strand the editor on <body> (typing then goes
      // nowhere). Nothing else re-arms after the burst, so look again once the oldest recovery has aged out.
      if (!floorRetry) {
        floorRetry = later(() => {
          floorRetry = null;
          if (editing === e && !disposed && focusLost(doc.activeElement)) armFloor();
        }, FLOOR_SPAN_MS - (t - recoveries[0]) + 20);
      }
      return false;
    }
    floor = { start: t, cancel: null };
    floor.cancel = frameLater(() => floorTick(e));
    return true;
  };
  const attachFloor = (e) => {
    const onIn = () => { e.ready = true; };
    const onOut = (event) => {
      if (editing !== e || !e.ready) return;
      const to = event.relatedTarget;
      if (to) return; // focus moved to a real target (inside the editor or elsewhere)
      armFloor();
    };
    e.editor.addEventListener("focusin", onIn);
    e.editor.addEventListener("focusout", onOut);
    const MO = doc.defaultView?.MutationObserver || globalThis.MutationObserver;
    let mo = null;
    if (typeof MO === "function") {
      mo = new MO(() => { if (editing === e && e.ready && focusLost(doc.activeElement)) armFloor(); });
      try { mo.observe(e.editor, { childList: true, subtree: true }); } catch { /* stub */ }
    }
    // The editing card grows with its text: report its live height so the view can grow the section around it.
    const RO = doc.defaultView?.ResizeObserver || globalThis.ResizeObserver;
    let ro = null;
    if (typeof RO === "function" && onEditResize) {
      ro = new RO(() => { if (editing === e) onEditResize(e.uid, Number(e.rec.el?.offsetHeight) || 0); });
      try { ro.observe(e.editor); } catch { /* stub */ }
    }
    floorTeardown = () => {
      e.editor.removeEventListener("focusin", onIn);
      e.editor.removeEventListener("focusout", onOut);
      mo?.disconnect();
      ro?.disconnect();
      floor?.cancel?.();
      floor = null;
      floorRetry?.();
      floorRetry = null;
    };
  };
  const recoverFocus = () => armFloor();

  const stopEvent = (event) => event.stopPropagation();
  // Rule 19.1: keep these off the diagram block's ancestors. mouseup is NOT listed on purpose: Roam arms
  // block drag-select on the mousedown it gets from the editor and disarms it only in a document-level
  // bubble mouseup listener. Stopping mouseup leaves that state armed, and the next block that appears
  // under the resting pointer (the one Enter creates) turns the text edit into a block selection.
  const EDITOR_STOPPED = ["pointerdown", "pointerup", "click", "dblclick", "wheel", "mousedown"];

  const EDIT_FADE_MS = 80;
  // offsetHeight is layout pixels. getBoundingClientRect is after the world scale, and using it
  // as min-height makes the card grow by that scale on the next frame.
  const boxHeight = (node) => {
    const h = Number(node?.offsetHeight) || 0;
    return h > 0 ? h : 0;
  };
  const prefersReducedMotion = () => {
    const mq = doc.defaultView?.matchMedia;
    if (typeof mq !== "function") return false;
    try { return Boolean(mq.call(doc.defaultView, "(prefers-reduced-motion: reduce)")?.matches); }
    catch { return false; }
  };
  const clearEditFade = (e) => {
    e?.fadeCancel?.();
    e?.releaseCancel?.();
    if (e) { e.fadeCancel = null; e.releaseCancel = null; }
  };
  // The static layer stays in the body until the editor is opaque, then this drops it.
  const dropStaticLayer = (rec) => {
    unmountRoots(rec);
    rec.ghost?.remove();
    rec.ghost = null;
  };
  const releaseEditLock = (rec) => {
    if (!rec?.el) return;
    rec.el.style.minHeight = "";
    // Drop the edit !important pin. The value stays; only the priority goes back to the normal inline height.
    if (rec.el.style?.height) rec.el.style.height = rec.el.style.height;
    if (rec.body?.style) rec.body.style.minHeight = "";
    rec.el.classList.remove("pxd-item--xfade");
  };

  // EK-1: Roam only sizes its textarea on the next input, so a card with two lines of text opened clipped to one.
  // Give the textarea its content height once, as Roam does on input; a later input still resizes it.
  const fitEditorText = (editor) => {
    for (const ta of editor.querySelectorAll?.("textarea") || []) {
      const need = Number(ta.scrollHeight) || 0;
      if (need > (Number(ta.clientHeight) || 0) + 1 && !ta.style?.height) ta.style.height = `${need}px`;
    }
  };

  const PAGE_FOCUS_MS = 1000;
  const pageInput = (editor, row) => {
    if (row) {
      for (const node of editor.querySelectorAll?.(".rm-block__input") || []) {
        if (String(node.id || node.getAttribute?.("id") || "").endsWith(`-${row}`)) return node;
      }
      return null;
    }
    return editor.querySelector?.(".rm-block__input") || editor.querySelector?.("textarea") || null;
  };
  // Page cards focus the clicked row on the first frame its input exists. They do not wait for hydrate-quiet.
  const waitPageInput = async (editor, row, uid) => {
    const start = now();
    let input = pageInput(editor, row);
    while (!input && now() - start < PAGE_FOCUS_MS) {
      await new Promise((resolve) => { frameLater(resolve); });
      if (disposed || editing?.uid !== uid) return null;
      input = pageInput(editor, row);
    }
    return input || editor.querySelector?.(".rm-block__input") || editor.querySelector?.("textarea") || null;
  };

  // A selected page card enters edit on pointerup. The board root calls preventDefault on pointerdown,
  // so a click listener never sees the gesture. The caret is stored while the rest rows still exist.
  const pageHitIgnored = (target) => Boolean(target?.closest?.(".pxd-row__fold, .pxd-row__more, .pxd-grip, .pxd-port"));
  const rememberPageCaret = (rec, event) => {
    pagePointer = null;
    if (!rec?.body || disposed) return;
    if (event.button != null && event.button !== 0) return;
    if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
    if (pageHitIgnored(event.target)) return;
    if (editing?.uid === rec.uid) return;
    const x = Number(event.clientX);
    const y = Number(event.clientY);
    const hit = Number.isFinite(x) && Number.isFinite(y) ? pageCaretAtPoint(doc, x, y) : null;
    const rowEl = event.target?.closest?.("[data-pxd-row]");
    const row = hit?.row || rowEl?.getAttribute?.("data-pxd-row") || "";
    if (!row) return;
    const offset = Number(hit?.offset);
    pagePointer = {
      uid: rec.uid,
      row,
      offset: Number.isFinite(offset) ? offset : 0,
      x: Number.isFinite(x) ? x : 0,
      y: Number.isFinite(y) ? y : 0,
      selected: Boolean(rec.selected),
      at: now(),
    };
  };
  const armPageCaret = (rec) => {
    if (!rec?.body || rec.pageCaret) return;
    rec.pageCaret = true;
    const onDown = (event) => { if (!disposed) rememberPageCaret(rec, event); };
    const onUp = (event) => {
      if (disposed) return;
      const pending = pagePointer;
      if (!pending || pending.uid !== rec.uid || !pending.selected) return;
      if (event.button != null && event.button !== 0) return;
      if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
      if (pageHitIgnored(event.target)) return;
      if (editing?.uid === rec.uid) return;
      const dx = (Number(event.clientX) || 0) - pending.x;
      const dy = (Number(event.clientY) || 0) - pending.y;
      if ((dx * dx) + (dy * dy) > PAGE_CLICK_PX * PAGE_CLICK_PX) return;
      enterEdit(rec.uid, { row: pending.row, offset: pending.offset });
    };
    const onDbl = (event) => {
      if (disposed || editing?.uid === rec.uid) return;
      if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
      if (pageHitIgnored(event.target)) return;
      const x = Number(event.clientX);
      const y = Number(event.clientY);
      const hit = Number.isFinite(x) && Number.isFinite(y) ? pageCaretAtPoint(doc, x, y) : null;
      const rowEl = event.target?.closest?.("[data-pxd-row]");
      const row = hit?.row || rowEl?.getAttribute?.("data-pxd-row") || "";
      if (!row) return;
      const offset = Number(hit?.offset);
      enterEdit(rec.uid, { row, offset: Number.isFinite(offset) ? offset : 0 });
    };
    rec.body.addEventListener("pointerdown", onDown);
    rec.body.addEventListener("pointerup", onUp);
    rec.body.addEventListener("dblclick", onDbl);
    rec.pageCaretOff = () => {
      rec.body?.removeEventListener("pointerdown", onDown);
      rec.body?.removeEventListener("pointerup", onUp);
      rec.body?.removeEventListener("dblclick", onDbl);
      if (pagePointer?.uid === rec.uid) pagePointer = null;
      rec.pageCaretOff = null;
    };
  };

  const enterEdit = async (uid, { row = "", offset } = {}) => {
    const rec = shells.get(uid);
    const item = lastBoard?.items.get(uid);
    if (!rec || !item || rec.type === "section" || item.kind === "board" || item.kind === "drawing-ref" || rec.refBoard) return false;
    if (editing?.uid === uid) return true;
    const pending = pagePointer;
    const fresh = Boolean(pending && pending.uid === uid && (now() - pending.at) <= PAGE_CARET_MS);
    if (fresh) pagePointer = null;
    let caretRow = String(row || "");
    const given = Number(offset);
    let caretOff = Number.isFinite(given) ? given : null;
    if (fresh) {
      if (!caretRow) caretRow = String(pending.row || "");
      if (caretOff == null && (!row || row === pending.row)) {
        const n = Number(pending.offset);
        if (Number.isFinite(n)) caretOff = n;
      }
    }
    if (isSticky(item)) return focusSticky(uid);
    // P32-5: with the reading pane, a PDF card never edits in place. The editor would mount Roam's reader
    // inside the card (the huge page on select). Open, Enter and the Open pill go to the pane instead.
    if (item.kind === "pdf" && onReadPane) return false;
    // window.event lives only for this turn. Read the dblclick before the first await, while the rest
    // string is still in the card. A keyboard Enter has no letter to land on, so it keeps Roam's caret.
    const click = doc.defaultView?.event;
    if (item.kind !== "page" && caretOff == null) {
      const type = String(click?.type || "");
      const mouse = type === "dblclick" || type === "click" || type === "pointerdown" || type === "pointerup" || type === "mousedown" || type === "mouseup";
      const x = Number(click?.clientX);
      const y = Number(click?.clientY);
      const target = click?.target;
      if (mouse && Number.isFinite(x) && Number.isFinite(y) && (!target || rec.el.contains?.(target))) {
        const hit = noteCaretAtPoint(doc, x, y);
        if (hit && (!hit.uid || hit.uid === uid)) {
          const mark = hit.task ? (TASK_MARK.exec(String(item.string || ""))?.[0].length || 0) : 0;
          caretOff = hit.offset + mark;
        }
      }
    }
    if (editing) await exitEdit();
    if (!host?.renderBlock) { host?.openBlock?.(uid); return false; }
    const targetUid = item.target.kind === "block" ? item.target.uid : item.uid;
    const heavyUid = ownHeavyUid(item);
    if (heavyUid) {
      if (pdfOpenUid && pdfOpenUid !== heavyUid) {
        const prev = pdfOpenUid;
        const prevShell = shellUidFor(prev);
        pdfOpenUid = heavyUid;
        if (pdfLiveUid && pdfLiveUid !== uid) endPdfInteract();
        if (onReadPane) {
          const prevItem = prevShell ? lastBoard?.items.get(prevShell) : null;
          if (!prevItem || prevItem.kind === "pdf") tellPane({ open: false });
        }
        if (prevShell && prevShell !== uid) remountPdf(prevShell);
        try { onToast?.("Closed the other reader"); } catch { /* toast */ }
        try { onEmbedOpen?.(heavyUid); } catch { /* outline */ }
      } else if (pdfOpenUid !== heavyUid) {
        pdfOpenUid = heavyUid;
        try { onEmbedOpen?.(heavyUid); } catch { /* outline */ }
      }
      unmountRoots(rec);
    }
    // Measure before any mount. A 0 box (stub, detached) falls back to the stored card height.
    const pageEdit = item.kind === "page";
    const contentH = boxHeight(rec.body);
    const lockH = pageEdit ? 0 : (boxHeight(rec.el) || contentH || Number(rec.rect?.h) || 0);
    const reduced = prefersReducedMotion();
    // PG-3: where the clicked row sits in the card, so the editor can put the same block back under the pointer.
    const clickedRow = caretRow ? rec.body.querySelector?.(`[data-pxd-row="${caretRow}"]`) : null;
    const rowOffset = clickedRow
      ? (Number(clickedRow.getBoundingClientRect?.().top) || 0) - (Number(rec.body.getBoundingClientRect?.().top) || 0)
      : null;
    let taskPad = 0;
    const taskLine = rec.body.querySelector?.(".pxd-item__taskline");
    const taskText = taskLine?.querySelector?.(".pxd-item__tasktext");
    if (taskLine && taskText) {
      const delta = (Number(taskText.offsetLeft) || 0) - (Number(taskLine.offsetLeft) || 0);
      if (delta > 1) taskPad = Math.round(delta);
    }
    const ghost = el("div", "pxd-item__ghost");
    ghost.setAttribute("aria-hidden", "true");
    for (const node of [...(rec.body.children || [])]) ghost.append(node);
    rec.body.append(ghost);
    rec.ghost = ghost;
    rec.contentKey = null;
    mounted.delete(uid);
    const editor = el("div", pageEdit ? "pxd-item__editor pxd-page-edit" : "pxd-item__editor", rec.body);
    if (taskPad) editor.style.setProperty("--pxd-task-pad", `${taskPad}px`);
    // Rule 19.1: stop pointer/wheel at the overlay boundary BEFORE the synthetic focus click.
    for (const type of EDITOR_STOPPED) editor.addEventListener(type, stopEvent);
    editing = { uid, rec, editor, targetUid, item, ready: false, fadeCancel: null, releaseCancel: null };
    if (pageEdit) {
      const h = rec.el.style?.height || (Number(rec.rect?.h) > 0 ? `${Math.round(Number(rec.rect.h))}px` : "");
      if (h && rec.el.style?.setProperty) rec.el.style.setProperty("height", h, "important");
    } else if (rec.el.style?.height && rec.el.style.setProperty) {
      rec.el.style.setProperty("height", rec.el.style.height, "important");
    }
    rec.el.classList.add("pxd-item--editing");
    renderBadges(rec);
    syncKidsBadge(rec, item);
    if (lockH > 0) rec.el.style.minHeight = `${lockH}px`;
    if (pageEdit || reduced) dropStaticLayer(rec);
    else rec.el.classList.add("pxd-item--xfade");
    lastOutsideDown = -Infinity;
    attachFocusGuard();
    attachFloor(editing);
    onEditChange?.(uid);
    let ok = true;
    try {
      if (pageEdit) {
        const pageUid = host.pageUid?.(item.title);
        if (pageUid && host.renderPage) host.renderPage(editor, pageUid, { "hide-mentions?": true });
        else host.renderBlock(editor, item.uid);
      } else {
        host.renderBlock(editor, targetUid);
      }
    } catch { ok = false; }
    if (!ok) { await exitEdit({ silent: true }); return false; }
    // EK-1: the measured box is the card's floor for the whole edit. A note editor is absolutely placed under a
    // zoom counter-scale, so it never holds the card open; only exitEdit releases the lock. A page editor stays
    // in world px (PGE-2), the same size as the rows it replaces.
    // Page cards skip the cross-fade. The outline and the editor would not match, and the fade is the delay.
    if (!pageEdit && !reduced) {
      editing.fadeCancel = later(() => {
        if (editing?.uid !== uid) return;
        editing.fadeCancel = null;
        rec.el.classList.remove("pxd-item--xfade");
        dropStaticLayer(rec);
      }, EDIT_FADE_MS);
    }
    let input = null;
    let placedScroll = null;
    if (pageEdit) {
      input = await waitPageInput(editor, caretRow, uid);
      if (disposed || editing?.uid !== uid) return false;
      if (input && rowOffset !== null) {
        const inputOffset = (Number(input.getBoundingClientRect?.().top) || 0) - (Number(rec.body.getBoundingClientRect?.().top) || 0);
        placedScroll = pageEditScrollTop(editor.scrollTop, inputOffset, rowOffset, zoomCache);
        editor.scrollTop = placedScroll;
      }
      // The window id comes from an input inside this editor, so the caret hits the embed, not the outline.
      if (input && caretOff != null && caretRow) {
        const win = pageEditWindowId(editor);
        const place = host?.api?.ui?.setBlockFocusAndSelection;
        if (win && typeof place === "function") {
          try {
            place({
              location: { "block-uid": caretRow, "window-id": win },
              selection: { start: caretOff, end: caretOff },
            });
          } catch { /* api */ }
        }
      }
    } else {
      await waitHydrateQuiet(editor, HYDRATE_CAP_MS);
      if (disposed || editing?.uid !== uid) return false;
      if (rowOffset !== null) {
        for (const node of editor.querySelectorAll?.(".rm-block__input") || []) {
          if (String(node.id || node.getAttribute?.("id") || "").endsWith(`-${row}`)) { input = node; break; }
        }
        if (input) {
          const delta = (Number(input.getBoundingClientRect?.().top) || 0) - (Number(rec.body.getBoundingClientRect?.().top) || 0) - rowOffset;
          if (delta && rec.body) rec.body.scrollTop = Math.max(0, (Number(rec.body.scrollTop) || 0) + delta / (zoomCache || 1));
        }
      }
      if (!input) input = editor.querySelector?.(".rm-block__input") || editor.querySelector?.("textarea");
    }
    const placeNoteCaret = () => {
      if (pageEdit || caretOff == null) return;
      const nodes = [input, editor.querySelector?.("textarea"), editor.querySelector?.(".rm-block__input")];
      for (const node of nodes) {
        if (typeof node?.setSelectionRange !== "function") continue;
        try { node.setSelectionRange(caretOff, caretOff); } catch { /* range */ }
        return;
      }
    };
    scaleCardEditor(editor, zoomCache);
    if (input) focusRoamInput(input);
    if (input && pageEdit && caretOff != null && typeof input.setSelectionRange === "function") {
      try { input.setSelectionRange(caretOff, caretOff); } catch { /* range */ }
    }
    placeNoteCaret();
    if (pageEdit && placedScroll != null) editor.scrollTop = placedScroll;
    // A page row is 20px. Fitting the textarea to scrollHeight is what made one rest line wrap and shove the rows below.
    if (!pageEdit) fitEditorText(editor);
    // Roam writes an explicit textarea height when a note editor focuses. Apply the counter-scale again
    // after that, and once more on the next frame, so the screen font is not clipped. Page edit skips it.
    // The synthetic click lands at the textarea's left edge, so the range is set again after it.
    scaleCardEditor(editor, zoomCache);
    placeNoteCaret();
    frameLater(() => {
      if (editing?.uid !== uid) return;
      scaleCardEditor(editor, zoomCache);
      if (!pageEdit) {
        fitEditorText(editor);
        placeNoteCaret();
      }
      if (pageEdit && placedScroll != null) editor.scrollTop = placedScroll;
    });
    if (editing?.uid === uid && editor.contains?.(doc.activeElement)) editing.ready = true;
    if (editing?.uid === uid) nudgeEditorMenus(doc);
    return true;
  };

  const exitEdit = async ({ silent = false } = {}) => {
    const pop = menuRoot?.querySelector?.(".bp3-popover-open");
    trackPopover = Boolean(pop);
    if (trackPopover) nudgeEditorMenus(doc);
    const e = editing;
    if (!e) return;
    if (e.sticky) {
      // The live block stays mounted. Blur it so Roam saves, and drop the typing state.
      const active = doc.activeElement;
      if (active && e.editor.contains?.(active)) active.blur?.();
      endStickyEdit();
      return;
    }
    editing = null;
    clearEditFade(e);
    detachFocusGuard();
    const { rec, editor, uid, item } = e;
    applyEditorCounterScale(editor, 1);
    const contentH = Number(editor.scrollHeight) || 0;
    for (const type of EDITOR_STOPPED) editor.removeEventListener(type, stopEvent);
    dropStaticLayer(rec);
    try { host?.unmount?.(editor); } catch { /* not mounted */ }
    editor.remove();
    rec.el.classList.remove("pxd-item--editing");
    releaseEditLock(rec);
    rec.contentKey = null;
    mounted.delete(uid);
    if (rec.type === "card") { rec.bare = true; rec.el.classList.add("pxd-item--bare"); }
    if (!silent && !disposed) {
      const live = lastBoard?.items.get(uid) || item;
      if (live && shells.has(uid)) {
        mountContent(rec, live);
        paintShell(rec, live);
        mounted.set(uid, now());
        renderBadges(rec);
      }
      onEditChange?.(null);
      const need = contentH + (["page", "board"].includes(item.kind) || item.collapsed ? HEADER_H : 0) + 20;
      if (contentH > 0 && live && item.kind !== "page" && need > live.h) {
        const grow = Math.min(GROW_CAP, need);
        if (grow > live.h) (onGrow || ((u, h) => session?.growToFit?.(u, h)))(uid, grow);
      }
    }
  };

  const autocompleteOpen = () => Boolean(doc.querySelector?.(".rm-autocomplete__results"));

  // Section title inline rename (plain contenteditable; writes the block string).
  const renameSection = (uid) => {
    const rec = shells.get(uid);
    const item = lastBoard?.items.get(uid);
    if (!rec || !item || rec.type !== "section") return false;
    const t = rec.title;
    unmountRoots(rec);
    t.replaceChildren();
    t.textContent = item.string || "";
    t.classList.add("pxd-section__title--editing");
    t.contentEditable = "true";
    t.setAttribute("contenteditable", "true");
    const finish = (commit) => {
      t.contentEditable = "false";
      t.removeAttribute("contenteditable");
      t.classList.remove("pxd-section__title--editing");
      t.removeEventListener("keydown", onKey);
      t.removeEventListener("blur", onBlur);
      t.removeEventListener("pointerdown", stopEvent);
      const next = String(t.textContent || "").trim();
      rec.titleRendered = false;
      rec.contentKey = null;
      mounted.delete(uid);
      if (commit && next !== item.string) (onRenameCommit || ((u, s) => session?.setString?.(u, s)))(uid, next);
      else t.textContent = item.title || "Section";
    };
    const onKey = (event) => {
      if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); finish(true); }
      else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(false); }
      else event.stopPropagation();
    };
    const onBlur = () => finish(true);
    t.addEventListener("keydown", onKey);
    t.addEventListener("blur", onBlur);
    t.addEventListener("pointerdown", stopEvent);
    try { t.focus({ preventScroll: true }); } catch { t.focus?.(); }
    // Start with the whole text selected so typing replaces it (Heptabase/Roam rename behavior).
    try { const d = t.ownerDocument; const r = d.createRange(); r.selectNodeContents(t); const s = d.getSelection(); s.removeAllRanges(); s.addRange(r); } catch { /* no selection API */ }
    return true;
  };

  // Board title inline rename on the card header (plain contenteditable; writes the block string).
  const renameBoard = (uid) => {
    const rec = shells.get(uid);
    const item = lastBoard?.items.get(uid);
    if (!rec || !item || item.kind !== "board" || !item.enhanced || !rec.header || rec.renaming) return false;
    const h = rec.header;
    const seed = parseBoardTitle(item.string);
    rec.renaming = true;
    h.textContent = seed;
    h.classList.add("pxd-item__header--editing");
    h.classList.remove("pxd-item__header--muted");
    h.contentEditable = "true";
    h.setAttribute("contenteditable", "true");
    const finish = (commit) => {
      if (!rec.renaming) return;
      rec.renaming = false;
      h.contentEditable = "false";
      h.removeAttribute("contenteditable");
      h.classList.remove("pxd-item__header--editing");
      h.removeEventListener("keydown", onKey);
      h.removeEventListener("blur", onBlur);
      h.removeEventListener("pointerdown", stopEvent);
      h.removeEventListener("dblclick", stopEvent);
      const next = String(h.textContent || "").trim();
      const live = lastBoard?.items.get(uid) || item;
      h.textContent = live.title || "";
      h.classList.toggle("pxd-item__header--muted", isUntitledBoard(live.title));
      if (commit && next !== seed) commitBoardName(uid, next);
    };
    const onKey = (event) => {
      if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); finish(true); }
      else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(false); }
      else event.stopPropagation();
    };
    const onBlur = () => finish(true);
    h.addEventListener("keydown", onKey);
    h.addEventListener("blur", onBlur);
    h.addEventListener("pointerdown", stopEvent);
    h.addEventListener("dblclick", stopEvent);
    try { h.focus({ preventScroll: true }); } catch { h.focus?.(); }
    try { const d = h.ownerDocument; const r = d.createRange(); r.selectNodeContents(h); const sel = d.getSelection(); sel.removeAllRanges(); sel.addRange(r); } catch { /* no selection API */ }
    return true;
  };

  // Page title on the card header. Commits through onRenamePage, which confirms past ten references.
  const renamePage = (uid) => {
    const rec = shells.get(uid);
    const item = lastBoard?.items.get(uid);
    if (!rec || !item || item.kind !== "page" || !rec.header || rec.renaming) return false;
    const h = rec.header;
    const seed = String(item.title || "").trim();
    rec.renaming = true;
    h.textContent = seed;
    h.classList.add("pxd-item__header--editing");
    h.contentEditable = "true";
    h.setAttribute("contenteditable", "true");
    const win = doc.defaultView;
    const finish = (commit) => {
      if (!rec.renaming) return;
      rec.renaming = false;
      h.contentEditable = "false";
      h.removeAttribute("contenteditable");
      h.classList.remove("pxd-item__header--editing");
      win?.removeEventListener("keydown", onKey, true);
      h.removeEventListener("blur", onBlur);
      h.removeEventListener("pointerdown", stopEvent);
      h.removeEventListener("dblclick", stopEvent);
      const next = String(h.textContent || "").trim();
      const live = lastBoard?.items.get(uid) || item;
      h.textContent = String(live.title || seed).slice(0, HEADER_TEXT_MAX);
      if (commit && next && next !== seed) onRenamePage?.(seed, next);
    };
    // Window capture: Roam's document listener takes Enter before a bubble listener on the header.
    const onKey = (event) => {
      const here = event.target === h || h.contains?.(event.target);
      if (!here) return;
      if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); finish(true); }
      else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(false); }
    };
    const onBlur = () => finish(true);
    win?.addEventListener("keydown", onKey, true);
    h.addEventListener("blur", onBlur);
    h.addEventListener("pointerdown", stopEvent);
    h.addEventListener("dblclick", stopEvent);
    try { h.focus({ preventScroll: true }); } catch { h.focus?.(); }
    try { const d = h.ownerDocument; const r = d.createRange(); r.selectNodeContents(h); const s = d.getSelection(); s.removeAllRanges(); s.addRange(r); } catch { /* no selection API */ }
    return true;
  };

  let regionWatch = null;
  const onRegionChange = (detail) => {
    const eventUid = detail && typeof detail === "object" ? detail.uid : null;
    if (!eventUid) return;
    refreshRegionKinds(eventUid);
  };
  const bindRegionWatch = () => {
    const api = regionWindow().RoamPlexus;
    if (regionWatch === api) return;
    try { regionWatch?.removeEventListener?.("change", onRegionChange); } catch { /* already gone */ }
    regionWatch = api && typeof api.addEventListener === "function" ? api : null;
    try { regionWatch?.addEventListener("change", onRegionChange); } catch { /* foreign api */ }
  };
  const refreshRegionKinds = (eventUid) => {
    if (disposed || !lastBoard) return;
    const api = regionWindow().RoamPlexus ?? null;
    let changed = false;
    for (const item of lastBoard.items.values()) {
      if (item.type !== "card" || (item.kind !== "block" && item.kind !== "region-ref" && item.kind !== "drawing-ref")) continue;
      const ref = item.target?.kind === "block" ? item.target.uid : null;
      if (!ref) continue;
      if (item.kind === "drawing-ref") {
        // A drawing card lists its regions and thumbnail: remount when its drawing's regions change.
        if (eventUid && ref !== eventUid) continue;
        const live = shells.get(item.uid);
        if (live && mounted.has(item.uid) && editing?.uid !== item.uid) {
          unmountContent(item.uid);
          changed = true;
        }
        continue;
      }
      if (eventUid && item.regionDrawing && item.regionDrawing !== eventUid && ref !== eventUid) continue;
      let text = null;
      try { text = host?.blockString?.(ref); } catch { text = null; }
      const model = regionRefModel(typeof text === "string" ? text : "", api);
      const drawing = model?.drawingUid || item.regionDrawing || "";
      if (eventUid && drawing !== eventUid && ref !== eventUid) continue;
      const nextKind = model ? "region-ref" : "block";
      const nextTitle = model ? (model.caption ?? "") : firstLine(item.string);
      const same = item.kind === nextKind && (item.title || "") === nextTitle && (item.regionDrawing || "") === (model?.drawingUid || "");
      if (!model && item.kind !== "region-ref") continue;
      if (model) {
        item.kind = "region-ref";
        item.title = model.caption ?? "";
        item.regionDrawing = model.drawingUid;
      } else {
        item.kind = "block";
        item.title = firstLine(item.string);
        delete item.regionDrawing;
      }
      const rec = shells.get(item.uid);
      if (rec && editing?.uid !== item.uid) paintShell(rec, item);
      if (!same || eventUid) {
        changed = true;
        if (rec && mounted.has(item.uid) && editing?.uid !== item.uid) unmountContent(item.uid);
      }
    }
    if (changed && lastContent && !quieted) fillContent(lastContent);
  };
  const onRegionReady = () => { bindRegionWatch(); refreshRegionKinds(null); };
  const onRegionUnload = () => {
    try { regionWatch?.removeEventListener?.("change", onRegionChange); } catch { /* already gone */ }
    regionWatch = null;
    refreshRegionKinds(null);
  };
  const regionWin = regionWindow();
  leaveRegionHub = joinRegionHub(regionWin, {
    root: menuRoot || itemsLayer || { isConnected: true },
    onReady: onRegionReady,
    onUnload: onRegionUnload,
    release: () => {
      try { regionWatch?.removeEventListener?.("change", onRegionChange); } catch { /* already gone */ }
      regionWatch = null;
    },
  });
  bindRegionWatch();

  const dropRegionWatch = () => {
    leaveRegionHub?.();
    leaveRegionHub = () => {};
    try { regionWatch?.removeEventListener?.("change", onRegionChange); } catch { /* already gone */ }
    regionWatch = null;
    unregisterMenus?.();
    unregisterMenus = () => {};
  };
  const dispose = () => {
    disposed = true;
    tellPane({ open: false });
    if (freshTimer) { try { freshTimer(); } catch { /* already ran */ } freshTimer = null; }
    freshPending.clear();
    try { pdfLiveOff?.(); } catch { /* already off */ }
    pdfLiveOff = null;
    pdfLiveUid = null;
    pdfOpenUid = null;
    dropRegionWatch();
    closePeek();
    if (editing) {
      const e = editing;
      clearEditFade(e);
      editing = null;
      detachFocusGuard();
      for (const type of EDITOR_STOPPED) e.editor.removeEventListener(type, stopEvent);
      e.rec.ghost?.remove();
      e.rec.ghost = null;
      try { host?.unmount?.(e.editor); } catch { /* not mounted */ }
    }
    stopFrames();
    contentSched?.dispose();
    if (unmountTimer) { unmountTimer(); unmountTimer = null; }
    for (const snap of [...snapshots]) dropSnapshot(snap);
    for (const uid of [...shells.keys()]) {
      const rec = shells.get(uid);
      try { rec.focusOff?.(); } catch { /* already off */ }
      try { rec.pageCaretOff?.(); } catch { /* already off */ }
      dropEmbedPoster(rec.el);
      unmountRoots(rec);
      dropKidsBadge(rec);
      rec.el.remove();
    }
    shells.clear();
    mounted.clear();
    dropRegionWatch();
  };

  return {
    sync,
    scheduleContent,
    quiet,
    setPaused,
    setLod,
    setZoom,
    previewMove,
    previewRects,
    previewSectionRects,
    resetRects,
    measureContent,
    toggleKids,
    setBadges,
    setShowBadges,
    setTrailBadges,
    setTaskChips,
    refreshStatuses,
    setFocus,
    setSelection,
    setHover,
    enterEdit,
    exitEdit,
    editingUid: () => editing?.uid ?? null,
    isEditing: () => Boolean(editing),
    recoverFocus,
    autocompleteOpen,
    renameSection,
    renameBoard,
    renamePage,
    shellOf: (uid) => shells.get(uid)?.el ?? null,
    drawnRect: (uid) => drawnRect(uid, lastRects?.get(uid)) ?? null,
    measureRow,
    setLayoutWatch,
    markRows,
    setRowHot,
    revealRow,
    repaintStyles() {
      syncBoardHighlighter(doc, boardRoot());
      if (!lastBoard) return;
      for (const [uid, rec] of shells) {
        if (editing?.uid === uid) continue;
        const item = lastBoard.items.get(uid);
        if (!item) continue;
        paintShell(rec, item);
        // The integrator has a new cover for this card. The shell class is already current.
        if (item.kind !== "pdf" || rec.contentKey == null) continue;
        const key = contentKeyFor(item);
        if (key === rec.contentKey) continue;
        unmountRoots(rec);
        rec.body?.replaceChildren?.();
        rec.contentKey = null;
        mountContent(rec, item);
      }
    },
    expireContent(uids) {
      for (const uid of uids || []) {
        const rec = shells.get(uid);
        if (!rec || editing?.uid === uid) continue;
        unmountRoots(rec);
        rec.body?.replaceChildren?.();
        rec.contentKey = null;
        mounted.delete(uid);
        contentSched?.drop(uid);
        rec.titleRendered = false;
        if (rec.type === "card") { rec.bare = true; rec.el.classList.add("pxd-item--bare"); }
        onPageLayout?.(uid);
      }
      if (uids?.length && lastContent) fillContent(lastContent);
    },
    openPdf,
    readInline,
    closeInline,
    inlineUid: () => inlineUid,
    openPdfAt,
    openPdfBlock,
    openEmbed,
    closeEmbed,
    endPdfInteract,
    flash: flashItem,
    mountedCount: () => mounted.size,
    mountedUids: () => [...mounted.keys()],
    shellCount: () => shells.size,
    lod: () => lod,
    dispose,
  };
}

export { DEFAULT_SIZES };
