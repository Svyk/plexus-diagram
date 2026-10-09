// Board view: DOM root, layers, render scheduler, culling, LOD (spec 3.2). One rAF loop that
// runs only when dirty; pan/zoom write one transform on .pxd-world plus the grid background.
// Entry used by feature.js: mountBoardView(...) → { root, setFullscreen, fit, dispose, stats, setSettings,
// state, exportSvg, copyOutline }.
//
// 1.2 wiring: three-tier LOD flipped by class during a gesture, board backgrounds (pattern + tone), live
// section auto-fit preview, context menu, clipboard, focus, presentation, card badges, back-to-content.

import { BOARD_PATTERNS, BOARD_TONES, DEFAULT_BOARD_CARD, DEFAULT_SIZES, LANE_SIZE, PAGE_CARD, PALETTE, STICKY_SIZE, UNTITLED_BOARD, classifyString, hexColor, readPlexus, semanticRef, plainText } from "../model/schema.js";
import { TABLE_SIZE, keyGate, ownershipOf, tablePointerTarget } from "../model/roam-table.js";
import { DRAWING_DROP_TOAST, drawingRefString, droppedDrawingUids } from "../model/drawing-card.js";
import { annotatePlan } from "../model/annotate.js";
import { rewriteBgTag } from "../model/highlighter.js";
import { boundsOf, buildBoard, connectedUids, containerAt, descendantsOf, displayRects, edgesTouching, outlineOrder, sameColorUids, sectionAllUids, sectionFitPlan, sectionNoteUid, sidebarOutlineUids, worldRects } from "../model/board.js";
import { trailBadges, trailPoints } from "../model/trails.js";
import { landmarkDots, landmarkUids, walkStops } from "../model/landmarks.js";
import { copyLinkText, hashFromUrl, pageUidFromHash, pxdTarget } from "../model/deeplink.js";
import { findOnBoard } from "../model/find.js";
import { readMindPreset, writeMindPreset } from "../model/mindmap.js";
import { attrLegend, parseAttrStyles, styleAttrLinks } from "../model/attr-styles.js";
import { HIGHLIGHT_COLORS, noteActionPlan } from "../model/highlight.js";
import { cleanPdfTitle, coverModel, embedSplit, parsedDocTitle, parsedTitleLines, pdfCardForUrl, pdfMacroUrl, readerRule } from "../model/pdf.js";
import { gestureSource, pasteCardPlan, pinOpenPlan, readWithSource } from "../model/pdf-pin.js";
import { parseRegion } from "../model/regions.js";
import { isMetaBanner } from "../model/title-cap.js";
import { createSharpStore } from "./sharp-store.js";
import { COVER_MAX_W, WARM_AFTER_MS, coverKey, coverState, densityTicks, sharpCoverPlan, warmPlan } from "../model/pdf-cover.js";
import { PDF_MARK, uidFromMark } from "../model/pdf-drag.js";
import { createCoverStore } from "../host/cover-store.js";
import { chipsForPdf } from "../model/pdf-chips.js";
import { expandDateHighlights, highlightRows, placeHighlights } from "../model/highlight-pick.js";
import { isDailyTitle } from "../model/library.js";
import { highlightLensTag, lensBright, lensCatalog, tagsForCard } from "../model/lens.js";
import { HALO_PULL_LIGHT, company, haloRefs, headerText, readHaloPull } from "../model/halo.js";
import { openHaloPopover } from "./halo-pop.js";
import { timelineQuery } from "../model/timeline.js";
import { createOpenStore, edgeOpens } from "../model/strength.js";
import { applyDust, applyStrength, clearLens } from "./strength-lens.js";
import { openWhyPopover } from "./why-pop.js";
import { leavesBoardPointer } from "./overlay-hit.js";
import { mountContextsDrawer } from "./contexts-drawer.js";
import { mountMemoryLane } from "./lane-bar.js";
import { breadcrumb, snippetOf } from "../model/contexts.js";
import { linkMention, suggestPairs } from "../model/suggest.js";
import { dropNamespace } from "../model/namespace.js";
import { isBareTask, isTaskAttr, isTaskString, setTaskAttrNames, taskMeta, taskState } from "../model/tasks.js";
import { createBt } from "../host/bt.js";
import { createTaskPopover } from "./task-popover.js";
import { createTaskCompleter } from "./task-complete.js";
import { placeNearAnchor } from "./avoid.js";
import { neighborLayout } from "../model/neighbors.js";
import { isQueryString, queryResultLayout, queryResultUids } from "../model/query.js";
import {
  alignRects,
  center,
  distributeRects,
  fitViewport,
  gridBackground,
  invZoom,
  screenPx,
  lodFonts,
  lodTier,
  panToShow,
  rectsIntersect,
  screenToWorld,
  viewportFromWorldRect,
  visibleWorldRect,
  worldToScreen,
  zoomAt,
} from "../model/geometry.js";
import { captionForView, selectionViewRect } from "../model/view-save.js";
import { PLEXUS_MIME, copyPayload, editorPastePlan, imageMarkdown, inlineAtCaret, parsePastedText } from "../model/clipboard.js";
import { boardToMarkdown, boardToSvg, dropExternalImages, imageSrc, pngFileName, sliceBoard } from "../model/export.js";
import { createInteractions } from "./interactions.js";
import { openPagePicker } from "./board-picker.js";
import { createItemRenderer, dropEmbedPoster, isTextEntryTarget, pageBodyWantsWheel, paintEmbedPoster, syncBoardHighlighter } from "./cards.js";
import { createReadPane, highlightDropPlan, originBeside, placeDecision, readerJumpPlan } from "./read-pane.js";
import { BUILTIN_OPTIONS, readParsedUrls } from "./parse-view.js";
import { createPdfWarm } from "./pdf-warm.js";
import { createFirstPageRenderer, createPdfMetaLookup, detectPdfjs, firstPageAllowed } from "./pdf-first-page.js";
import { createThemeFollow } from "./theme-follow.js";
import { PDF_DARK_CLASSES, createPdfFlip, pdfDarkClass } from "./pdf-flip.js";
import { openViewDialog } from "./view-dialog.js";
import { viewMapModel } from "./minimap-svg.js";
import { openRegionDeleteDialog } from "./region-delete-dialog.js";
import { imageRegionRows, regionDeleteCopy, regionRefCount, renameRegionCaption } from "../model/region-menu.js";
import { boardKeyIsOutside } from "./offscreen.js";
import { editorKeyAction, inputBlockRole } from "./editor-keys.js";
import { createEdgeLayer } from "./edges.js";
import { createChrome, LINK_MODES } from "./chrome.js";
import { cameraRectOf, regionCamera, setCameraFromView } from "./region-hover-geom.js";
import { mountRegionMark } from "./region-mark.js";
import { syncEmptyHint } from "./empty-hint.js";
import { applyMotionClasses, motionProfile, resolveMotion } from "./motion.js";
import { mountTable } from "./table-view.js";
import { mountKanban } from "./kanban-view.js";
import { createPropsPanel } from "./props-panel.js";
import { PANEL_WIDTH_DEFAULT, nextPanelWidth } from "../model/info.js";
import { LONG_PRESS_CANCEL_PX, LONG_PRESS_MS, longPressAt } from "../model/touch.js";
import { closeTab, openTab, tabAt } from "../model/tabs.js";
import { createPanel, parseDropPayload } from "./panel.js";
import { handleOfficeDrop, handleParseDrop } from "../model/drop.js";
import { officeTargetFromText } from "../model/anydoc-to-parse.js";
import { createAnydocHost } from "../host/anydoc.js";
import { createParseStore, restorableByUrl } from "../host/parse-store.js";
import { sharedDeviceOcr } from "../host/device-ocr.js";
import { scheduleTitleLexiconWarm } from "./title-lexicon-warm.js";
import { createParseActions, freeSpotBeside } from "./parse-actions.js";
import { createMenu } from "./menu.js";
import { createShortcutSheet } from "./shortcut-sheet.js";
import { createTypeAhead } from "./type-ahead.js";
import { createTooltip } from "./tooltip.js";
import { findShortcut } from "./shortcuts.js";
import { applyStatusPicks, buildMenu } from "./menu-model.js";
import { statusApi, statusPalette } from "../model/status-tags.js";
import { createQuickLook } from "./quicklook.js";
import { boardCramped, freeBoardArea, pdfDockLift } from "../model/card-face.js";
import { createPresenter } from "./present.js";
import { createClipboardIO, dragHasImages, filesFromDataTransfer, writeClipboard } from "./clipboard-io.js";
import { applyFullscreenChrome, watchRouteExit } from "./fullscreen.js";
import { embedOwnerUid } from "../discovery.js";
import {
  ATTRIBUTE_TEMPLATE,
  FOCUS_MS,
  backgroundImage,
  highlightHits,
  sectionPair,
  thumbnailBudget,
  timerStep,
  versionPeekRequest,
  zoomThreshold,
} from "../model/section6.js";
import { mountLater, mountPrintSheet } from "./later-views.js";
import { cellElementOf, cellUidOf, isTableCard } from "./table-cells.js";
import { endpointUnderPointer, focusEnds, imageSourceOf, regionDropPlan, wireStart } from "../model/endpoints.js";

const SVG_NS = "http://www.w3.org/2000/svg";

// The board under the pointer. Focus inside a board wins over this; fullscreen does not.
let pointerBoard = null;

// Sidebar window ids look like sidebar-window-sidebar-block-<uid> or sidebar-outline- / mentions.
export function sidebarMountKind(nativeEl) {
  const win = nativeEl?.closest?.(".rm-sidebar-window");
  if (!win) return "main";
  const id = String(win.id || "");
  if (id.includes("mentions")) return "mentions";
  if (id.includes("outline")) return "outline";
  return "block";
}

// Main keeps the 1.2 key. A sidebar copy adds the window kind. An embed adds the
// embed block uid, so two copies of one board do not share a pan or overwrite the main camera.
export function viewportStorageId(nativeEl, boardUid, readString) {
  const kind = sidebarMountKind(nativeEl);
  if (kind !== "main") return `${boardUid}:${kind}`;
  const owner = embedOwnerUid(nativeEl, readString);
  if (owner) return `${boardUid}:embed:${owner}`;
  return boardUid;
}
const DEFAULT_HEIGHT = 560;

function rasterizeSvg(doc, svg) {
  return new Promise((resolve, reject) => {
    const Img = doc.defaultView?.Image || globalThis.Image;
    if (typeof Img !== "function" || typeof URL === "undefined" || typeof Blob === "undefined") { resolve(null); return; }
    const img = new Img();
    let url = "";
    try { url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })); }
    catch { resolve(null); return; }
    img.onload = () => {
      try {
        const canvas = doc.createElement("canvas");
        const w = img.naturalWidth || img.width || 1;
        const h = img.naturalHeight || img.height || 1;
        canvas.width = Math.max(1, Math.round(w * 2));
        canvas.height = Math.max(1, Math.round(h * 2));
        const g = canvas.getContext?.("2d");
        if (!g || typeof canvas.toBlob !== "function") { URL.revokeObjectURL(url); resolve(null); return; }
        g.setTransform(2, 0, 0, 2, 0, 0);
        g.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => { URL.revokeObjectURL(url); resolve(blob); }, "image/png");
      } catch (err) { try { URL.revokeObjectURL(url); } catch { /* already revoked */ } reject(err); }
    };
    img.onerror = () => { try { URL.revokeObjectURL(url); } catch { /* already revoked */ } resolve(null); };
    img.src = url;
  });
}

// A card made by a gesture is junk only when the block, the model and the open editor are all blank.
// Roam debounces the block string, so the editor text is what the user actually typed.
export function freshCardIsBlank({ blockString, itemString, contentCount = 0, editorText = "" } = {}) {
  if (contentCount > 0) return false;
  // A task block that still holds only its TODO marker is as empty as a blank card.
  return ![blockString, itemString, editorText].some((s) => !isBareTask(s) && String(s ?? "").trim());
}

function editingPlainText(root) {
  const editor = root.querySelector?.(".pxd-item--editing .pxd-item__editor");
  if (!editor) return "";
  const areas = typeof editor.querySelectorAll === "function" ? [...editor.querySelectorAll("textarea")] : [];
  if (areas.length) return areas.map((t) => t.value || "").join("\n");
  return typeof editor.textContent === "string" ? editor.textContent : "";
}

// Roam's textarea is controlled. A DOM write only sticks when the native setter fires input.
function commitTextareaValue(el, value) {
  if (!el) return;
  const view = el.ownerDocument?.defaultView || globalThis;
  const Proto = view.HTMLTextAreaElement;
  const set = Proto && Object.getOwnPropertyDescriptor(Proto.prototype, "value")?.set;
  if (typeof set === "function") {
    try { set.call(el, value); } catch { el.value = value; }
  } else el.value = value;
  try {
    const Ev = view.Event || globalThis.Event;
    if (typeof Ev === "function" && typeof el.dispatchEvent === "function") {
      el.dispatchEvent(new Ev("input", { bubbles: true }));
      el.dispatchEvent(new Ev("change", { bubbles: true }));
    }
  } catch { /* stub event */ }
}
const MIN_HEIGHT = 240;
const RESUME_MS = 120;
const VP_PERSIST_MS = 500;
const SECTION_TITLE_ALLOWANCE = 32; // px: section title pill (20 + padding) plus its 4px lift, fits above the frame
const CULL_MARGIN = 1;
const BADGE_TTL_MS = 120000;
const BADGE_CHUNK = 12;
const NATIVE_MENU_TARGETS = ".rm-page-ref, .rm-block-ref, [data-link-uid], a[href], img";

// A checkbox toggles and an image opens Roam's viewer. A page or block ref navigates.
// These must not be turned into "enter edit" by the card's own click.
function nativeClickKind(node) {
  if (!node || typeof node.closest !== "function") return null;
  if (node.closest("img")) return "image";
  if (node.closest(".pxd-task-check")) return "checkbox";
  const box = node.closest("input, label, .check-container");
  if (box) {
    const tag = String(box.tagName || "").toLowerCase();
    if (tag === "input") {
      if (String(box.getAttribute?.("type") || "").toLowerCase() === "checkbox") return "checkbox";
    } else if (box.classList?.contains("check-container") || box.querySelector?.('input[type="checkbox"]')) {
      return "checkbox";
    }
  }
  if (node.closest("[data-link-uid], .rm-page-ref, .rm-block-ref")) return "ref";
  return null;
}

// renderString draws a checkbox with no block of its own, so the click has to flip the card string.
// A page linked from more than ten blocks asks before data.page.update rewrites every reference.
export function pageRenameNeedsConfirm(refCount) {
  return Number(refCount) > 10;
}

// An arrow end handle sits half under the card it ends on, so the card wins the browser hit-test there.
// A pointer within `radius` px of a handle centre grabs the handle instead.
// This scan reads layout (getBoundingClientRect). Gesture code uses edgeEndNearWorld instead.
export function edgeEndNear(root, x, y, radius = 10) {
  const handles = root?.querySelectorAll?.(".pxd-edge__end");
  if (!handles?.length) return null;
  let best = null;
  let bestD = radius;
  for (const h of handles) {
    const r = h.getBoundingClientRect();
    const d = Math.hypot(r.left + r.width / 2 - x, r.top + r.height / 2 - y);
    if (d <= bestD) { best = h; bestD = d; }
  }
  if (!best) return null;
  const edge = best.closest?.(".pxd-edge");
  return { kind: "edge-end", uid: edge?.dataset?.uid || edge?.getAttribute?.("data-uid"), end: best.dataset?.end || best.getAttribute?.("data-end") };
}

// Handle centres stored in world space when the edge renders. `radius` is screen px.
// `zoom` turns the world distance into screen px, so a pan never has to read layout.
export function edgeEndNearWorld(centers, world, radius = 10, zoom = 1) {
  if (!world || !centers?.length) return null;
  const z = zoom || 1;
  let best = null;
  let bestD = radius;
  for (const h of centers) {
    if (!h || !Number.isFinite(h.x) || !Number.isFinite(h.y)) continue;
    const d = Math.hypot((h.x - world.x) * z, (h.y - world.y) * z);
    if (d <= bestD) { best = h; bestD = d; }
  }
  if (!best) return null;
  return { kind: "edge-end", uid: best.uid, end: best.end };
}

export function toggleTodoAt(string, index = 0) {
  if (typeof string !== "string") return null;
  const marks = [...string.matchAll(/\{\{\[\[(?:TODO|DONE)\]\]\}\}/g)];
  const mark = marks[index];
  if (!mark) return null;
  const next = mark[0].includes("TODO") ? "{{[[DONE]]}}" : "{{[[TODO]]}}";
  return string.slice(0, mark.index) + next + string.slice(mark.index + mark[0].length);
}
const BADGE_MAX = 60;
const NOTE_KINDS = ["note", "block", "page"];

function createTimers() {
  const active = new Set();
  const later = (fn, ms) => {
    const id = setTimeout(() => { active.delete(entry); fn(); }, ms);
    const entry = () => { clearTimeout(id); active.delete(entry); };
    active.add(entry);
    return entry;
  };
  const frame = (fn) => {
    const raf = globalThis.requestAnimationFrame;
    let entry;
    if (typeof raf === "function") {
      const id = raf((t) => { active.delete(entry); fn(t); });
      entry = () => { globalThis.cancelAnimationFrame?.(id); active.delete(entry); };
    } else {
      const id = setTimeout(() => { active.delete(entry); fn(Date.now()); }, 16);
      entry = () => { clearTimeout(id); active.delete(entry); };
    }
    active.add(entry);
    return entry;
  };
  const idle = (fn) => {
    const ric = globalThis.requestIdleCallback;
    let entry;
    if (typeof ric === "function") {
      const id = ric((d) => { active.delete(entry); fn(d); });
      entry = () => { globalThis.cancelIdleCallback?.(id); active.delete(entry); };
    } else {
      const id = setTimeout(() => { active.delete(entry); fn({ timeRemaining: () => 8, didTimeout: true }); }, 0);
      entry = () => { clearTimeout(id); active.delete(entry); };
    }
    active.add(entry);
    return entry;
  };
  return { later, frame, idle, count: () => active.size, cancelAll: () => { for (const c of [...active]) c(); active.clear(); } };
}

const ANNOTATE_TOAST = "Drop the image into the drawing";

// Survives the board unmount that follows RoamPlexus.open, so it is not tied to one view. The extension's
// unload calls clearPinnedToast(), which drops the node and its timer.
let pinned = null;

export function clearPinnedToast() {
  const entry = pinned;
  pinned = null;
  if (!entry) return;
  try { entry.cancel?.(); } catch { /* timer already fired */ }
  try { entry.node.remove(); } catch { /* already gone */ }
}

export function pinAnnotateToast(doc, win = globalThis) {
  const body = doc?.body;
  if (!body || typeof doc.createElement !== "function") return;
  clearPinnedToast();
  try { body.querySelector(".pxd-toast--pin")?.remove(); } catch { /* none yet */ }
  const node = doc.createElement("div");
  node.className = "pxd-toast pxd-toast--pin";
  node.setAttribute("role", "status");
  const span = doc.createElement("span");
  span.className = "pxd-toast__text";
  span.textContent = ANNOTATE_TOAST;
  node.append(span);
  body.append(node);
  const id = win.setTimeout?.(() => { if (pinned?.node === node) pinned = null; try { node.remove(); } catch { /* already gone */ } }, 6000);
  pinned = { node, cancel: () => win.clearTimeout?.(id) };
}

export function isDarkHost(root, doc = globalThis.document) {
  const has = (el, name) => Boolean(el?.classList?.contains?.(name));
  let node = root;
  while (node) {
    if (has(node, "bp3-dark") || has(node, "rm-dark-theme") || has(node, "bt-theme-dark")) return true;
    if (has(node, "roam-body") && has(node, "dark")) return true;
    node = node.parentElement;
  }
  const body = doc?.body;
  const html = doc?.documentElement;
  if (has(html, "bp3-dark") || has(body, "bt-theme-dark") || has(body, "bp3-dark") || has(body, "rm-dark-theme")) return true;
  if (has(body, "roam-body") && has(body, "dark")) return true;
  return false;
}

const rgbOf = (value) => {
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%)?)?\s*\)$/.exec(String(value ?? "").trim());
  if (!m) return null;
  const a = m[4] == null ? 1 : Number(m[4]) / (m[5] ? 100 : 1);
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a };
};

// True while the hit is inside a PDF reader that has Interact on. The board must not
// preventDefault that pointerdown, or page nav and the native fullscreen control never run.
export function pdfClickShield(target) {
  return Boolean(target?.closest?.(".pxd-pdf-live"));
}

// Native fullscreen owns Escape (the browser leaves it). Interact without fullscreen ends on Escape.
// Anything else keeps the board's own Escape chain.
export function pdfEscapeAction({ live, fullscreen } = {}) {
  if (fullscreen) return "native";
  if (live) return "end-interact";
  return "pass";
}

// Top-level blocks have the page as parent and no string, so the parent string defaults to "".
export const CONTEXTS_QUERY = "[:find ?u ?s ?pt ?t ?ps :in $ ?uid :where [?c :block/uid ?uid] [?b :block/refs ?c] [?b :block/uid ?u] [?b :block/string ?s] [?b :create/time ?t] [?b :block/page ?pg] [?pg :node/title ?pt] [?b :block/parents ?p] [?p :block/children ?b] [(get-else $ ?p :block/string \"\") ?ps]]";

export const PDF_HIGHLIGHTS_LABEL = "Add highlights";

const DATE_BLOCK = /^\[\[([^\[\]]+)\]\]$/;
const BLOCK_REF = /^\(\(([^()\s]+)\)\)$/;

function pageKey(page) {
  return page == null ? "none" : String(page);
}

export function isDateBlockString(string) {
  const match = DATE_BLOCK.exec(String(string ?? "").trim());
  return Boolean(match && isDailyTitle(match[1]));
}

// A date drop is ((uid)). A [[page]] string is not expanded here.
export function dateDropExpansion(dropString, block) {
  const text = String(dropString ?? "").trim();
  if (DATE_BLOCK.test(text)) return null;
  if (!BLOCK_REF.test(text)) return null;
  if (!block || !isDateBlockString(block.string)) return null;
  const uids = expandDateHighlights(block);
  if (!uids) return null;
  return { uids, message: `Add ${uids.length} highlights under this date?` };
}

export function planDroppedCards(list, { blockOf, confirm, card, page, at } = {}) {
  const rows = Array.isArray(list) ? list : [];
  const w = Number(card?.w) || 0;
  const h = Number(card?.h) || 0;
  const pw = Number(page?.w) || w;
  const ph = Number(page?.h) || h;
  const x = Number(at?.x) || 0;
  const y = Number(at?.y) || 0;
  const isPage = (string) => DATE_BLOCK.test(String(string).trim());
  let dropY = y - h / 2;
  const placed = [];
  for (const entry of rows) {
    const raw = String(entry?.string ?? "");
    if (!isPage(raw)) {
      let block = null;
      try { block = typeof blockOf === "function" ? blockOf(raw) : null; } catch { block = null; }
      const expansion = dateDropExpansion(raw, block);
      if (expansion) {
        let ok = false;
        try { ok = typeof confirm === "function" && confirm(expansion.message) === true; } catch { ok = false; }
        if (!ok) return null;
        for (const uid of expansion.uids) {
          placed.push({ string: `((${uid}))`, x: x - w / 2, y: dropY });
          dropY += h + 24;
        }
        continue;
      }
    }
    if (isPage(raw)) {
      placed.push({ string: raw, x: x - pw / 2, y: dropY, w: pw, h: ph });
      dropY += ph + 24;
    } else {
      placed.push({ string: raw, x: x - w / 2, y: dropY });
      dropY += h + 24;
    }
  }
  return placed;
}

export function lensRowLabel(tag) {
  const name = String(tag ?? "");
  if (!name) return "";
  if (name.startsWith("h/") && highlightLensTag(name.slice(2)) === name) return name.slice(2);
  return `#${name}`;
}

export function highlightPickerList(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const placed = row?.placed === true;
    return {
      ...row,
      placed,
      enabled: !placed,
      disabled: placed,
      checked: placed || row?.selected === true,
    };
  });
}

export function highlightPickerRows(rows, { color, page } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const colorOn = typeof color === "string" && color !== "";
  const pageOn = typeof page === "string" && page !== "";
  return list.filter((row) => {
    if (!row) return false;
    if (colorOn && row.color !== color) return false;
    if (pageOn && pageKey(row.page) !== page) return false;
    return true;
  });
}

// Select all on the current colour and page. Placed rows stay out of the place set.
export function selectHighlightPage(rows, { color, page } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const colorOn = typeof color === "string" && color !== "";
  const pageOn = typeof page === "string" && page !== "";
  return list.map((row) => {
    if (!row || row.placed === true) return { ...row, selected: false };
    if (colorOn && row.color !== color) return row;
    if (pageOn && pageKey(row.page) !== page) return row;
    return { ...row, selected: true };
  });
}

const HL_GLYPH = "M5.5 9.5L10.5 2.5l3 2.2-5 7zM5.5 9.5l-.9 2.7 3.9-.5M2 14.5h7";

// The header icon: a highlighter glyph, the highlight count when there is one, and the "Add highlights" tooltip.
export function pdfHighlightButton(doc, onClick, count = 0) {
  const btn = doc.createElement("button");
  btn.type = "button";
  btn.className = "pxd-pdf-highlights pxd-chrome";
  btn.setAttribute("aria-label", PDF_HIGHLIGHTS_LABEL);
  btn.setAttribute("data-tip", "pdf.highlights");
  if (typeof doc.createElementNS === "function") {
    const svg = doc.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "pxd-pdf-highlights__glyph");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");
    const path = doc.createElementNS(SVG_NS, "path");
    path.setAttribute("d", HL_GLYPH);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.4");
    path.setAttribute("stroke-linejoin", "round");
    svg.append(path);
    btn.append(svg);
  }
  const num = doc.createElement("span");
  num.className = "pxd-pdf-highlights__count";
  btn.append(num);
  setHighlightCount(btn, count);
  const stop = (event) => {
    event.preventDefault?.();
    event.stopPropagation?.();
  };
  btn.addEventListener("pointerdown", stop);
  btn.addEventListener("mousedown", stop);
  btn.addEventListener("dblclick", stop);
  btn.addEventListener("click", (event) => {
    stop(event);
    onClick?.(event);
  });
  return btn;
}

// The count shows only above zero. Returns the text it painted.
export function setHighlightCount(btn, count) {
  const n = Number(count);
  const text = Number.isFinite(n) && n > 0 ? String(Math.floor(n)) : "";
  const num = btn?.querySelector?.(".pxd-pdf-highlights__count");
  if (num && num.textContent !== text) num.textContent = text;
  if (num) {
    if (text) num.removeAttribute?.("hidden");
    else num.setAttribute?.("hidden", "");
  }
  btn?.setAttribute?.("data-count", text || "0");
  return text;
}

export function openHighlightDialog(doc, { rows, origin, onPlace, onClose } = {}) {
  let rowsState = (Array.isArray(rows) ? rows : []).map((row) => ({ ...row, selected: false }));
  const at = origin && typeof origin === "object" ? origin : { x: 0, y: 0 };
  const root = doc.createElement("div");
  root.className = "pxd-highlight-dialog pxd-popover pxd-chrome";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Add highlights");
  const stop = (event) => {
    event.preventDefault?.();
    event.stopPropagation?.();
  };
  root.addEventListener("pointerdown", (event) => event.stopPropagation?.());
  root.addEventListener("mousedown", (event) => event.stopPropagation?.());

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    root.remove();
    onClose?.();
  };
  root.close = close;

  const title = doc.createElement("div");
  title.className = "pxd-popover__title";
  title.textContent = "Add highlights";
  root.append(title);

  const filters = doc.createElement("div");
  filters.className = "pxd-hl-filters";
  const colorSel = doc.createElement("select");
  colorSel.className = "pxd-hl-color";
  colorSel.setAttribute("aria-label", "Colour");
  const pageSel = doc.createElement("select");
  pageSel.className = "pxd-hl-page";
  pageSel.setAttribute("aria-label", "Page");
  const colors = [];
  const pages = [];
  for (const row of rowsState) {
    if (row.color && !colors.includes(row.color)) colors.push(row.color);
    const key = pageKey(row.page);
    if (!pages.some((entry) => entry[0] === key)) pages.push([key, row.page == null ? "No page" : `Page ${row.page}`]);
  }
  const colorOrder = new Map(HIGHLIGHT_COLORS.map((name, index) => [name, index]));
  colors.sort((a, b) => (colorOrder.get(a) ?? 99) - (colorOrder.get(b) ?? 99));
  pages.sort((a, b) => {
    if (a[0] === "none") return 1;
    if (b[0] === "none") return -1;
    return Number(a[0]) - Number(b[0]);
  });
  const addOption = (select, value, label) => {
    const opt = doc.createElement("option");
    opt.value = value;
    opt.setAttribute("value", value);
    opt.textContent = label;
    select.append(opt);
  };
  addOption(colorSel, "", "All colours");
  for (const name of colors) addOption(colorSel, name, name);
  addOption(pageSel, "", "All pages");
  for (const [value, label] of pages) addOption(pageSel, value, label);
  const allBtn = doc.createElement("button");
  allBtn.type = "button";
  allBtn.className = "pxd-btn pxd-hl-all";
  allBtn.textContent = "Select all on page";
  allBtn.setAttribute("aria-label", "Select all on page");
  filters.append(colorSel, pageSel, allBtn);
  root.append(filters);

  const list = doc.createElement("div");
  list.className = "pxd-hl-list";
  root.append(list);

  const actions = doc.createElement("div");
  actions.className = "pxd-hl-actions";
  const gridBtn = doc.createElement("button");
  gridBtn.type = "button";
  gridBtn.className = "pxd-btn pxd-hl-grid";
  gridBtn.textContent = "Place as grid";
  gridBtn.setAttribute("aria-label", "Place as grid");
  const columnBtn = doc.createElement("button");
  columnBtn.type = "button";
  columnBtn.className = "pxd-btn pxd-hl-column";
  columnBtn.textContent = "Place as column";
  columnBtn.setAttribute("aria-label", "Place as column");
  actions.append(gridBtn, columnBtn);
  root.append(actions);

  const groupLabel = (row) => {
    const text = typeof row?.group === "string" ? row.group.trim() : "";
    return text || "Other";
  };
  const paint = () => {
    list.replaceChildren();
    const shown = highlightPickerRows(highlightPickerList(rowsState), { color: colorSel.value, page: pageSel.value });
    let lastGroup = null;
    for (const row of shown) {
      const label = groupLabel(row);
      if (label !== lastGroup) {
        lastGroup = label;
        const head = doc.createElement("div");
        head.className = "pxd-hl-group";
        head.textContent = label;
        list.append(head);
      }
      const line = doc.createElement("label");
      line.className = "pxd-hl-row";
      line.setAttribute("data-uid", row.uid || "");
      line.setAttribute("data-enabled", row.enabled ? "true" : "false");
      const box = doc.createElement("input");
      box.className = "pxd-hl-check";
      box.type = "checkbox";
      box.checked = row.checked === true;
      box.disabled = row.disabled === true;
      if (row.disabled) box.setAttribute("disabled", "");
      box.setAttribute("data-uid", row.uid || "");
      box.addEventListener("change", () => {
        if (row.placed) return;
        const live = rowsState.find((item) => item.uid === row.uid);
        if (live && live.placed !== true) live.selected = box.checked === true;
      });
      const bar = doc.createElement("span");
      bar.className = "pxd-hl-bar";
      bar.setAttribute("data-color", row.color || "gray");
      const text = doc.createElement("span");
      text.className = "pxd-hl-row__text";
      text.textContent = row.snippet || row.uid || "";
      const page = doc.createElement("span");
      page.className = "pxd-hl-rowpage";
      page.textContent = row.page == null ? "" : `p. ${row.page}`;
      line.append(box, bar, text, page);
      if (typeof row.note === "string" && row.note.trim()) {
        const mark = doc.createElement("span");
        mark.className = "pxd-hl-note";
        mark.setAttribute("aria-label", "Note");
        mark.textContent = "Note";
        line.append(mark);
      }
      list.append(line);
    }
  };
  const place = (mode) => {
    const result = placeHighlights(rowsState, { mode, origin: at });
    if (!result.items.length) return;
    onPlace?.(result.items, { omitted: result.omitted || 0 });
    close();
  };
  colorSel.addEventListener("change", paint);
  pageSel.addEventListener("change", paint);
  allBtn.addEventListener("click", (event) => {
    stop(event);
    rowsState = selectHighlightPage(rowsState, { color: colorSel.value, page: pageSel.value });
    paint();
  });
  gridBtn.addEventListener("click", (event) => { stop(event); place("grid"); });
  columnBtn.addEventListener("click", (event) => { stop(event); place("column"); });
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      stop(event);
      close();
      return;
    }
    event.stopPropagation?.();
  });
  paint();
  return root;
}

// True only when the host is measurably light: no dark marker, and the first opaque background up the chain
// (Roam paints only <body>; the app wrappers are transparent) has high luminance. The OS color-scheme hint must not
// darken a board that sits on a light host, so a confirmed-light host opts out of the prefers-color-scheme rules.
export function isLightHost(root, doc = globalThis.document, win = globalThis.window) {
  if (isDarkHost(root, doc)) return false;
  if (typeof win?.getComputedStyle !== "function") return false;
  for (let node = root; node; node = node.parentElement) {
    let color;
    try { color = rgbOf(win.getComputedStyle(node)?.backgroundColor); } catch { return false; }
    if (!color || color.a < 0.5) continue;
    return (0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b) / 255 > 0.6;
  }
  return false;
}

function graphName(win = globalThis.window) {
  const m = /#\/app\/([^/]+)/.exec(String(win?.location?.hash || ""));
  return m ? decodeURIComponent(m[1]) : "graph";
}

function createLocalViewportStore({ storage, graph, timers }) {
  const key = (uid) => `plexus-diagram:vp:${graph}:${uid}`;
  const pending = new Map();
  return {
    get(uid) {
      try {
        const raw = storage?.getItem?.(key(uid));
        if (!raw) return null;
        const v = JSON.parse(raw);
        return Number.isFinite(v?.x) && Number.isFinite(v?.y) && Number.isFinite(v?.zoom) ? v : null;
      } catch { return null; }
    },
    set(uid, vp) {
      if (!storage?.setItem) return;
      const write = () => { pending.delete(uid); try { storage.setItem(key(uid), JSON.stringify({ x: vp.x, y: vp.y, zoom: vp.zoom })); } catch { /* quota */ } };
      if (pending.has(uid)) { pending.get(uid).vp = vp; return; }
      const entry = { vp, cancel: timers.later(() => write(), VP_PERSIST_MS) };
      pending.set(uid, entry);
    },
    flush() { for (const [uid, e] of pending) { e.cancel(); try { storage?.setItem?.(key(uid), JSON.stringify(e.vp)); } catch { /* quota */ } } pending.clear(); },
  };
}

// The Roam host has no toast, so the reader's "Copied" / "Could not copy" / "Pinned p. N" went nowhere.
// Methods still resolve on the host through the prototype.
export function readPaneHost(host, toast) {
  if (!host || typeof host.toast === "function") return host;
  const wrapped = Object.create(host);
  wrapped.toast = (message) => toast(message);
  return wrapped;
}

function buildBoardView(onFail, {
  host,
  session,
  mountEl,
  nativeEl = null,
  settings,
  onRequestFullscreen,
  fullscreen = false,
  version = "",
  crumbs = null,
  onOpenBoard = null,
  onCrumb = null,
  onHistoryBack = null,
  onHistoryForward = null,
  initialViewport = null,
  routeUid = session.uid,
  autofocus = false,
  onSetDefaults = null,
  perfLog = null,
  lifecycle = null,
  onSelectTab = null,
  tabStore = null,
  boardsOf = null,
} = {}) {
  const doc = globalThis.document;
  const win = globalThis.window;
  // The settings object can be swapped (setSettings); chrome and the controller read through a stable proxy.
  let settingsRef = settings;
  const readSetting = (k) => (typeof settingsRef?.get === "function" ? settingsRef.get(k) : settingsRef?.[k]);
  const settingsProxy = { get: readSetting };
  // One bridge for the life of the board. enabled is read again on every tool lookup, including after setSettings.
  const bt = createBt({
    enabled: () => readSetting("better-tasks") === true,
    win,
  });
  const setting = (k, d) => {
    const v = readSetting(k);
    return v === undefined || v === null ? d : v;
  };
  const flag = (k, d) => {
    const v = setting(k, d);
    return v === false || v === "false" ? false : v === true || v === "true" ? true : Boolean(v);
  };
  let motionMq = null;
  try { motionMq = win?.matchMedia?.("(prefers-reduced-motion: reduce)") || null; } catch { motionMq = null; }
  const prefersReducedMotion = () => Boolean(motionMq?.matches);
  const currentMotion = () => resolveMotion(setting("motion", "full"), prefersReducedMotion());
  const timers = createTimers();
  const listeners = [];
  const observers = [];
  const subs = [];
  // Set before any document or window listener runs. A suspended board stays
  // registered and returns immediately, so dispose can still remove the same functions.
  let suspended = false;
  const listen = (el, type, fn, opts) => {
    const wrapped = (event) => {
      if (suspended) return;
      return fn(event);
    };
    el.addEventListener(type, wrapped, opts);
    const off = () => el.removeEventListener(type, wrapped, opts);
    listeners.push(off);
    return off;
  };
  // observe() targets, so resume can attach the same observer to the same nodes.
  const observed = new WeakMap();
  const trackObserver = (observer) => {
    if (!observer || observed.has(observer)) return observer;
    const records = [];
    observed.set(observer, records);
    const observe = typeof observer.observe === "function" ? observer.observe.bind(observer) : null;
    const unobserve = typeof observer.unobserve === "function" ? observer.unobserve.bind(observer) : null;
    const disconnect = typeof observer.disconnect === "function" ? observer.disconnect.bind(observer) : null;
    if (observe) {
      observer.observe = (target, options) => {
        const at = records.findIndex((row) => row.target === target);
        const row = { target, options };
        if (at >= 0) records[at] = row;
        else records.push(row);
        return observe(target, options);
      };
    }
    if (unobserve) {
      observer.unobserve = (target) => {
        const at = records.findIndex((row) => row.target === target);
        if (at >= 0) records.splice(at, 1);
        return unobserve(target);
      };
    }
    if (disconnect) {
      observer.disconnect = () => {
        records.length = 0;
        return disconnect();
      };
    }
    return observer;
  };
  const suspendObservers = () => {
    for (const obs of observers) {
      const records = observed.get(obs) || [];
      obs._pxdHeld = records.map((row) => ({ target: row.target, options: row.options }));
      try { obs.disconnect(); } catch { /* already off */ }
    }
  };
  const resumeObservers = () => {
    for (const obs of observers) {
      const held = obs._pxdHeld || [];
      obs._pxdHeld = null;
      for (const row of held) {
        try { obs.observe(row.target, row.options); } catch { /* the node is gone */ }
      }
    }
  };
  const el = (tag, cls, parent) => {
    const node = doc.createElement(tag);
    node.className = cls;
    parent?.append(node);
    return node;
  };
  const svg = (cls, parent) => {
    const node = doc.createElementNS(SVG_NS, "svg");
    node.setAttribute("class", cls);
    if (node.classList && !node.classList.contains(cls)) node.className = cls;
    parent?.append(node);
    return node;
  };

  const boardUid = session.uid;
  const graph = host?.graph || graphName(win);
  const storage = globalThis.localStorage;
  let dateMode = "attribute";
  let strengthOn = false;
  let dustPeriod = "off";
  let strengthScores = null;
  let dustAges = null;
  let strengthGen = 0;
  let strengthStale = false;
  let dustGen = 0;
  let openStore = null;
  let timelineRows = null;
  let timelineCacheUid = "";
  let timelinePending = null;
  let timelinePendingUid = "";
  const trackOpensOn = () => readSetting("track-opens") === true;
  const bumpOpen = (uid) => {
    if (!uid || !openStore) return;
    try { openStore.bump(uid); } catch { /* storage */ }
  };
  const vpStore = host?.viewports || host?.viewportStore || createLocalViewportStore({ storage, graph, timers });
  const tabsStore = tabStore || host?.tabs || null;
  let memoryTabs = [];
  const readTabs = () => {
    if (typeof tabsStore?.get === "function") {
      try {
        const stored = tabsStore.get();
        if (Array.isArray(stored)) return stored;
      } catch { /* the session list still paints */ }
    }
    return memoryTabs;
  };
  const openBoardTab = (entry) => {
    if (typeof tabsStore?.open === "function") {
      const next = tabsStore.open(entry);
      memoryTabs = next?.tabs || [];
      return next;
    }
    const next = openTab(readTabs(), entry);
    memoryTabs = next.tabs;
    try { tabsStore?.set?.(next.tabs); } catch { /* quota */ }
    return next;
  };
  const closeBoardTab = (uid) => {
    if (typeof tabsStore?.close === "function") {
      const next = tabsStore.close(uid);
      memoryTabs = next?.tabs || [];
      return next;
    }
    const next = closeTab(readTabs(), uid);
    memoryTabs = next.tabs;
    try { tabsStore?.set?.(next.tabs); } catch { /* quota */ }
    return next;
  };
  // The inline height belongs to the mount (the route board), not to whichever nested board it is showing.
  const heightKey = `plexus-diagram:h:${graph}:${routeUid}`;

  // ------------------------------------------------------------ DOM
  const root = el("div", "pxd-root", mountEl);
  // FIX-TYPE-1: keys typed before a new card's textarea is live are kept and replayed into it.
  const typeAhead = createTypeAhead({
    doc,
    later: (fn, ms) => timers.later(fn, ms),
    isTarget: (node) => String(node?.tagName || "").toLowerCase() === "textarea" && Boolean(root.contains?.(node) && node.closest?.(".pxd-item")),
  });
  root.tabIndex = 0;
  root.setAttribute("tabindex", "0");
  root.setAttribute("role", "region");
  root.setAttribute("aria-roledescription", "whiteboard");
  root.setAttribute("aria-label", "Diagram");
  root.dataset.tool = "select";
  root.setAttribute("data-tool", "select");
  root.dataset.board = boardUid;
  const viewport = el("div", "pxd-viewport", root);
  const grid = el("div", "pxd-grid", viewport);
  const world = el("div", "pxd-world", viewport);
  const sectionsLayer = el("div", "pxd-sections", world);
  const edgesSvg = svg("pxd-edges", world);
  const labelsLayer = el("div", "pxd-labels", world);
  const itemsLayer = el("div", "pxd-items", world);
  const overlaySvg = svg("pxd-overlay", world);
  const emptyHint = el("div", "pxd-empty pxd-chrome", root);
  const resizeGrip = el("div", "pxd-resize-grip pxd-chrome", root);
  resizeGrip.title = "Drag to resize the board";
  // The dark/light class follows the host: decided at mount, then again whenever the host flips (Roam's auto theme
  // follows the OS, and the theme extensions toggle their marker classes on <html>/<body>).
  let repaintItemStyles = () => {};
  let themeKey = null;
  let themeFollow = null;
  try {
    themeFollow = createThemeFollow({
      doc,
      root,
      timers,
      getMode: () => (setting("theme", "follow-roam") === "plexus" ? "plexus" : "follow-roam"),
    });
  } catch { themeFollow = null; }
  // G2. One dark-mode class for PDF pages. The filter itself lives in CSS and only runs while the board is dark.
  const applyPdfDark = () => {
    const want = pdfDarkClass(readSetting("pdf-dark"));
    for (const name of PDF_DARK_CLASSES) root.classList.toggle(name, name === want);
  };
  const applyTheme = () => {
    const dark = isDarkHost(mountEl, doc);
    root.classList.toggle("pxd-root--dark", dark);
    root.classList.toggle("pxd-root--light", !dark && isLightHost(mountEl, doc, globalThis.window));
    applyPdfDark();
    const hl = syncBoardHighlighter(doc, root);
    try { themeFollow?.apply?.(); } catch { /* theme */ }
    // Cards repaint only when the dark flag or the highlighter flips, not on every html/body class change.
    const key = `${dark}|${hl}`;
    const flipped = themeKey !== null && key !== themeKey;
    themeKey = key;
    if (!flipped || disposed) return;
    repaintItemStyles();
    scheduleContent();
  };
  applyTheme();

  // ------------------------------------------------------------ state
  // Main keeps the 1.2 key. A sidebar copy adds the window kind. An embed keeps its own key.
  const readBlock = (id) => {
    try { return host?.blockString?.(id); } catch { return null; }
  };
  const inSidebar = sidebarMountKind(nativeEl) !== "main";
  const vpId = viewportStorageId(nativeEl, boardUid, readBlock);
  const embedCopy = vpId !== boardUid && vpId.startsWith(`${boardUid}:embed:`);
  let vp = vpStore.get(vpId);
  // Start from the main camera, but never write that key from this copy.
  if (!vp && embedCopy) {
    const main = vpStore.get(boardUid);
    if (main && Number.isFinite(main.x) && Number.isFinite(main.y) && Number.isFinite(main.zoom) && main.zoom > 0) {
      vp = { x: main.x, y: main.y, zoom: main.zoom };
    }
  }
  if (
    initialViewport
    && Number.isFinite(initialViewport.x)
    && Number.isFinite(initialViewport.y)
    && Number.isFinite(initialViewport.zoom)
    && initialViewport.zoom > 0
  ) {
    vp = { x: initialViewport.x, y: initialViewport.y, zoom: initialViewport.zoom };
  }
  let size = { width: 0, height: 0 };
  let rootRect = { left: 0, top: 0, width: 0, height: 0 };
  let disposed = false;
  let disposing = false;
  let released = false;
  let gesturing = false;
  let isFullscreen = false;
  let pointerInside = Boolean(mountEl?.matches?.(":hover"));
  let suppressClick = false;
  let swallowMouseUp = false;
  let linkMode = setting("graph-links", "all");
  let suggestMode = "off";
  let suggestWarned = false;
  let suggestSelKey = "";
  const suggestDismissed = new Set();
  let whyPop = null;
  let contextsDrawer = null;
  let memoryLane = null;
  let lanePreview = false;
  let laneMarks = null; // { future, fresh } sets from the last lane frame; re-applied after every card re-sync
  let lanePreviewLayout = null;
  let linksMenu = null;
  let selection = { items: [], edge: null, link: null };
  let liveRects = null; // Map override during move/resize preview
  let grown = new Set(); // section uids whose shells show a live auto-fit preview
  let tier = "detail"; // 'detail' | 'map' | 'overview'
  let bgPattern; // effective board pattern / tone; undefined until applyBackground() runs
  let bgTone;
  let bgHex = null;
  let bgImage = null;
  let bgOverride = false;
  let timerHud = null;
  let timerState = null;
  let timerTick = null;
  let focusOn = false;
  let focusKey = null;
  let lensTag = null;
  let lensIndex = new Map();
  let highlightDialog = null;
  let presentSet = null;
  let sendPending = null; // uids waiting for a target board picked in the Boards tab
  let menuCtx = null;
  let regionMark = null;
  let lastPayload = null; // last copy payload, so a menu paste can restore the plexus items
  let lastPointer = null; // last pointer position in client coords, converted with a fresh measure() at paste time
  let backVisible = false;
  let badgeTimer = null;
  const badgeCache = new Map(); // key -> { at, stats }
  const badgePending = new Set(); // keys with a stats query queued or running
  let resumeTimer = null;
  let settleTimer = null;
  let searchMatches = [];
  let searchIndex = -1;
  let frameHandle = null;
  let fsDispose = () => {};
  let routeOff = () => {};
  const dirty = { viewport: false, items: new Set(), edges: new Set(), structural: false, all: true, selection: false, links: false, ctx: false, minimap: false };

  const board = () => session.board;

  // A sidebar root has no enhanced ancestor, so the collapsed board mounts here as a canvas.
  // Outline lists each top-level block (and Connections) without writing :block/open.
  // Rows render when they come within about a screen of the outline scroller, and unmount
  // past about three screens, keeping the last height so the scroll position stays put.
  // The Outline/Board choice is per board on this device. Opening does not write it.
  const OUTLINE_NEAR = "100% 0px";
  const OUTLINE_FAR = "300% 0px";
  const sidebarModeKey = `plexus-diagram:sidebar-mode:${graph}:${boardUid}`;
  let outlineMode = false;
  let outlineHost = null;
  let outlineKey = "";
  let outlineBtn = null;
  let boardBtn = null;
  let outlineNear = null;
  let outlineFar = null;
  const outlined = new WeakSet();
  let outlineLiveUid = null;
  const outlineRead = (id) => {
    const item = board()?.items.get(id);
    if (typeof item?.string === "string" && item.string.trim()) return item.string;
    try {
      const text = host?.blockString?.(id);
      return typeof text === "string" ? text : "";
    } catch { return ""; }
  };
  const outlineCover = (source) => {
    try { return host?.pdfCover?.(source) ?? null; } catch { return null; }
  };
  const outlineHeavies = (uid) => {
    const posters = [];
    const seenUid = new Set();
    const seenPoster = new Set();
    const add = (poster, fallback) => {
      if (!poster) return;
      const mount = poster.uid || fallback || "";
      const key = `${mount}\u0001${poster.kind || ""}\u0001${poster.title || ""}\u0001${poster.url || ""}`;
      if (seenPoster.has(key)) return;
      seenPoster.add(key);
      posters.push(mount ? { ...poster, uid: mount } : poster);
    };
    const fromText = (text, id) => {
      const split = embedSplit(text, { read: outlineRead, cover: outlineCover, uid: id });
      for (const poster of split.posters) add(poster, id);
    };
    const walk = (id, depth) => {
      if (!id || depth > 8 || seenUid.has(id)) return;
      seenUid.add(id);
      fromText(outlineRead(id), id);
      const item = board()?.items.get(id);
      for (const member of item?.members || []) walk(member, depth + 1);
      for (const kid of item?.content || []) {
        const kidUid = kid?.[":block/uid"] || kid?.uid || "";
        if (kidUid) walk(kidUid, depth + 1);
        else fromText(kid?.[":block/string"] ?? kid?.string ?? "", id);
      }
    };
    if (uid) walk(uid, 0);
    return posters;
  };
  const readSidebarMode = () => {
    try {
      const v = storage?.getItem?.(sidebarModeKey);
      return v === "outline" || v === "board" ? v : "";
    } catch { return ""; }
  };
  const writeSidebarMode = (mode) => {
    try { storage?.setItem?.(sidebarModeKey, mode); } catch { /* quota or private mode */ }
  };
  const forgetObserver = (obs) => {
    if (!obs) return;
    try { obs.disconnect(); } catch { /* already off */ }
    const i = observers.indexOf(obs);
    if (i >= 0) observers.splice(i, 1);
  };
  // leaveOutline, clearOutline, and dispose all come through here, so a hot reload cannot leave a scroll watcher up.
  const disconnectOutline = () => {
    const near = outlineNear;
    const far = outlineFar;
    outlineNear = null;
    outlineFar = null;
    forgetObserver(near);
    forgetObserver(far);
  };
  const rowHeight = (row) => {
    try {
      const h = row.getBoundingClientRect?.().height;
      if (h > 0) return h;
    } catch { /* stub */ }
    const off = Number(row.offsetHeight) || 0;
    return off > 0 ? off : 0;
  };
  const closeOutlineLive = () => {
    const prev = outlineLiveUid;
    outlineLiveUid = null;
    if (!prev || !outlineHost) return;
    for (const row of [...outlineHost.children]) {
      if (!row.querySelector?.(".pxd-embed-live")) continue;
      const live = row.querySelector(".pxd-rs__live");
      try { if (live) host?.unmount?.(live); } catch { /* stub */ }
      outlined.delete(row);
      try { row.replaceChildren(); } catch { /* stub */ }
      row.style.height = "";
      renderOutlineRow(row);
    }
  };
  const openOutlineEmbed = (uid) => {
    if (!uid) return;
    const rule = readerRule(outlineLiveUid, uid);
    if (rule.close == null && rule.open === (outlineLiveUid || null)) return;
    outlineLiveUid = rule.open || null;
    try { itemsR?.closeEmbed?.(); } catch { /* cards */ }
    if (!outlineHost) return;
    for (const row of [...outlineHost.children]) {
      const heavies = outlineHeavies(row.dataset?.uid);
      const hit = heavies.some((poster) => (poster.uid || row.dataset?.uid) === uid);
      const live = row.querySelector?.(".pxd-embed-live");
      if (!hit && !live) continue;
      const node = live?.querySelector?.(".pxd-rs__live");
      try { if (node) host?.unmount?.(node); } catch { /* stub */ }
      outlined.delete(row);
      try { row.replaceChildren(); } catch { /* stub */ }
      row.style.height = "";
      renderOutlineRow(row);
    }
  };
  const renderOutlineRow = (row) => {
    if (disposed || !row || outlined.has(row)) return;
    if (!outlineHost?.contains?.(row)) return;
    const uid = row.dataset?.uid || "";
    const heavies = uid ? outlineHeavies(uid) : [];
    if (heavies.length) {
      const own = outlineRead(uid);
      const ownSplit = embedSplit(own, { read: outlineRead, cover: outlineCover, uid });
      if (!ownSplit.posters.length && own.trim()) {
        const text = el("div", "pxd-outline-rest", row);
        text.textContent = plainText(own);
      }
      for (const poster of heavies) {
        const mount = poster.uid || uid;
        if (outlineLiveUid && mount === outlineLiveUid) {
          const liveWrap = el("div", "pxd-embed-poster pxd-embed-live", row);
          liveWrap.setAttribute("data-pxd-embed", mount);
          if (poster.kind) liveWrap.setAttribute("data-kind", poster.kind);
          const live = el("div", "pxd-rs__live", liveWrap);
          try { host?.renderBlock?.(live, mount); } catch { /* host */ }
        } else {
          const node = paintEmbedPoster(doc, row, { ...poster, uid: mount }, (id) => openOutlineEmbed(id || mount));
          const onFocus = () => openOutlineEmbed(mount);
          node.addEventListener("focusin", onFocus);
          const offs = node._pxdFocusOffs || (node._pxdFocusOffs = []);
          offs.push(() => node.removeEventListener("focusin", onFocus));
        }
      }
      row.style.height = "";
      outlined.add(row);
      return;
    }
    if (typeof host?.renderBlock !== "function") return;
    try { host.renderBlock(row, uid); } catch { return; }
    row.style.height = "";
    outlined.add(row);
  };
  const releaseOutlineRow = (row) => {
    if (!row || !outlined.has(row)) return;
    if (row.querySelector?.(".pxd-embed-live")) outlineLiveUid = null;
    for (const node of row.querySelectorAll?.(".pxd-embed-poster") || []) {
      const offs = node._pxdFocusOffs;
      if (offs) for (const off of offs.splice(0)) off();
      dropEmbedPoster(node);
    }
    const h = rowHeight(row);
    const live = row.querySelector?.(".pxd-rs__live");
    try { if (live) host?.unmount?.(live); } catch { /* stub */ }
    try { host?.unmount?.(row); } catch { /* stub */ }
    try { row.replaceChildren(); } catch { /* stub */ }
    if (h > 0) row.style.height = `${Math.ceil(h)}px`;
    outlined.delete(row);
  };
  const dropOutlineRow = (row) => {
    try { outlineNear?.unobserve?.(row); } catch { /* stub */ }
    try { outlineFar?.unobserve?.(row); } catch { /* stub */ }
    releaseOutlineRow(row);
  };
  const ensureOutlineObserver = () => {
    const IO = globalThis.IntersectionObserver;
    if (typeof IO !== "function" || !outlineHost) return false;
    if (outlineNear && outlineFar) return true;
    disconnectOutline();
    try {
      outlineNear = trackObserver(new IO((entries) => {
        if (disposed || suspended || !outlineMode) return;
        for (const entry of entries) if (entry.isIntersecting) renderOutlineRow(entry.target);
      }, { root: outlineHost, rootMargin: OUTLINE_NEAR }));
      outlineFar = trackObserver(new IO((entries) => {
        if (disposed || suspended || !outlineMode) return;
        for (const entry of entries) if (!entry.isIntersecting) releaseOutlineRow(entry.target);
      }, { root: outlineHost, rootMargin: OUTLINE_FAR }));
    } catch {
      disconnectOutline();
      return false;
    }
    observers.push(outlineNear, outlineFar);
    return true;
  };
  const watchOutlineRow = (row) => {
    if (!ensureOutlineObserver()) {
      renderOutlineRow(row);
      return;
    }
    try {
      outlineNear.observe(row);
      outlineFar.observe(row);
    } catch {
      renderOutlineRow(row);
    }
  };
  const clearOutline = () => {
    outlineLiveUid = null;
    disconnectOutline();
    if (!outlineHost) return;
    for (const row of [...outlineHost.children]) releaseOutlineRow(row);
    outlineHost.replaceChildren();
  };
  const syncOutline = (force = false) => {
    if (!outlineMode || !outlineHost || disposed) return;
    const uids = sidebarOutlineUids(board());
    const key = uids.join("\n");
    if (!force && key === outlineKey) return;
    outlineKey = key;
    if (force) clearOutline();
    const have = new Map();
    for (const row of [...outlineHost.children]) {
      const uid = row.dataset?.uid;
      if (uid && !have.has(uid)) have.set(uid, row);
    }
    const keep = new Set(uids);
    for (const [uid, row] of have) {
      if (keep.has(uid)) continue;
      dropOutlineRow(row);
      row.remove();
      have.delete(uid);
    }
    let cursor = outlineHost.firstChild;
    for (const uid of uids) {
      let row = have.get(uid);
      if (!row) {
        row = el("div", "pxd-sidebar-outline__row");
        row.dataset.uid = uid;
        row.setAttribute("data-uid", uid);
        if (cursor) outlineHost.insertBefore(row, cursor);
        else outlineHost.append(row);
        watchOutlineRow(row);
      } else if (row !== cursor) {
        outlineHost.insertBefore(row, cursor);
      }
      cursor = row.nextElementSibling;
    }
  };
  let tableMode = false;
  let tableCtl = { open() {}, close() {}, refresh() {}, dispose() {} };
  let kanbanMode = false;
  let kanbanCtl = { open() {}, close() {}, refresh() {}, dispose() {} };
  let lastOverlayClose = 0;
  const noteOverlayClosed = () => { lastOverlayClose = Date.now(); };
  let laterCtl = { open() { return false; }, close() {}, refresh() {}, isOpen() { return false; }, dispose() {} };
  const leaveOutline = () => {
    outlineMode = false;
    root.classList.remove("pxd-root--outline");
    outlineBtn?.classList.toggle("pxd-mode__btn--on", false);
    boardBtn?.classList.toggle("pxd-mode__btn--on", true);
    outlineKey = "";
    disconnectOutline();
    clearOutline();
  };
  const setTable = (on) => {
    const next = Boolean(on);
    if (next && outlineMode) leaveOutline();
    if (next && kanbanMode) setKanban(false);
    if (next) laterCtl.close();
    tableMode = next;
    root.classList.toggle("pxd-root--table", tableMode);
    chrome?.toolbar?.setTable?.(tableMode);
    if (tableMode) tableCtl.open();
    else tableCtl.close();
  };
  const setKanban = (on) => {
    const next = Boolean(on);
    if (next && outlineMode) leaveOutline();
    if (next && tableMode) setTable(false);
    if (next) laterCtl.close();
    kanbanMode = next;
    root.classList.toggle("pxd-root--kanban", kanbanMode);
    chrome?.toolbar?.setKanban?.(kanbanMode);
    if (kanbanMode) kanbanCtl.open();
    else kanbanCtl.close();
  };
  const setOutline = (on) => {
    outlineMode = Boolean(on);
    if (outlineMode && tableMode) setTable(false);
    if (outlineMode && kanbanMode) setKanban(false);
    root.classList.toggle("pxd-root--outline", outlineMode);
    outlineBtn?.classList.toggle("pxd-mode__btn--on", outlineMode);
    boardBtn?.classList.toggle("pxd-mode__btn--on", !outlineMode);
    if (outlineMode) syncOutline(true);
    else { outlineKey = ""; clearOutline(); }
  };
  if (inSidebar) {
    root.classList.add("pxd-root--sidebar");
    const modeBar = el("div", "pxd-mode pxd-chrome", root);
    modeBar.setAttribute("role", "group");
    modeBar.setAttribute("aria-label", "Sidebar view");
    const modeBtn = (cls, label, on) => {
      const b = doc.createElement("button");
      b.type = "button";
      b.className = `pxd-mode__btn ${cls}`;
      b.textContent = label;
      b.setAttribute("aria-label", label);
      modeBar.append(b);
      listen(b, "click", on);
      return b;
    };
    outlineBtn = modeBtn("pxd-mode__outline", "Outline", () => { writeSidebarMode("outline"); setOutline(true); });
    boardBtn = modeBtn("pxd-mode__board", "Board", () => { writeSidebarMode("board"); setOutline(false); });
    outlineHost = el("div", "pxd-sidebar-outline pxd-chrome", root);
  }

  const rects = () => session.rects || worldRects(board());
  const effectiveRects = () => {
    if (!liveRects) return rects();
    const merged = new Map(rects());
    for (const [k, v] of liveRects) merged.set(k, v);
    return merged;
  };
  // Paint and hit-test. Stored rects stay on `rects()` so a collapse never writes section h.
  let itemsReady = false;
  const paintRects = () => {
    const b = board();
    const base = effectiveRects();
    const shown = b ? displayRects(b, base) : base;
    if (!b || !itemsReady) return shown;
    // An open PDF reader is drawn larger than its model rect; arrows attach at the reader's border.
    let out = shown;
    for (const item of b.items.values()) {
      if (item.kind !== "pdf") continue;
      const drawn = itemsR.drawnRect?.(item.uid);
      const own = shown.get(item.uid);
      if (!drawn || !own || (drawn.w === own.w && drawn.h === own.h)) continue;
      if (out === shown) out = new Map(shown);
      out.set(item.uid, drawn);
    }
    return out;
  };

  let readPane = null;
  // Cover bytes stay local. The store and the warm mount exist only after a card asks, or a reader settles.
  let coverStore = null;
  let pdfWarm = null;
  let pdfFlip = null;
  let pdfHoverUid = "";
  let coverPaintAt = 0;
  let coverWarmWait = null;
  let readingCard = "";
  const coverFaces = new Map();
  const coverGen = new Map();
  const flashedMarks = [];
  // Below 420 × 280 screen px of board (a stacked reader under a narrow board) the minimap would sit on the cards.
  const syncCramped = () => {
    let box = null;
    let bar = null;
    try { box = viewport.getBoundingClientRect?.(); } catch { box = null; }
    try { bar = root.querySelector?.(".pxd-toolbar")?.getBoundingClientRect?.() || null; } catch { bar = null; }
    const want = boardCramped(freeBoardArea(box, bar));
    if (root.classList.contains("pxd-root--cramped") !== want) root.classList.toggle("pxd-root--cramped", want);
  };
  const measure = () => {
    const r = root.getBoundingClientRect();
    rootRect = { left: r.left || 0, top: r.top || 0, width: r.width || 0, height: r.height || 0 };
    size = { width: rootRect.width, height: rootRect.height };
    root.classList.toggle("pxd-root--narrow", size.width > 0 && size.width < 560);
    readPane?.layout?.(size.width);
    syncCramped();
  };

  // ------------------------------------------------------------ layers
  // A throw after the renderer exists must dispose it. Otherwise a retrying reconcile leaks a listener set per tick.
  onFail.push(
    () => { try { pdfFlip?.destroy?.(); pdfFlip = null; } catch { /* flip */ } },
    () => { try { pdfWarm?.cancelAll?.(); } catch { /* warm */ } },
    () => readPane?.dispose?.(),
    () => itemsR?.dispose?.(),
    () => routeOff(),
    () => fsDispose(),
    () => subs.splice(0).forEach((off) => { try { off?.(); } catch { /* already off */ } }),
    () => listeners.splice(0).forEach((off) => { try { off(); } catch { /* already off */ } }),
    () => observers.splice(0).forEach((o) => { try { o.disconnect(); } catch { /* already off */ } }),
    () => timers.cancelAll(),
    () => root.remove(),
  );
  let itemsR = null;
  let openPinFromChip = () => false;
  let notePdfMeta = () => "";
  const parsedTitles = new Map();
  // Page-1 lines behind a parsed title, for the metadata banner check (url → { pageTitle, lines }).
  const parsedEvidence = new Map();
  let pdfDisplayTitle = (card) => {
    const title = typeof card?.title === "string" ? card.title.trim() : "";
    return title && title !== "PDF" && !title.startsWith("{{") ? title : "PDF";
  };
  itemsR = createItemRenderer({
    doc,
    host,
    session,
    itemsLayer,
    sectionsLayer,
    timers,
    onEditChange: (uid) => {
      root.classList.toggle("pxd-root--editing", Boolean(uid));
      session.setEditing?.(uid || null);
      if (!uid && grown.size) { liveRects = null; resetGrown(); } // the edit ended: the commit (growToFit) takes over
    },
    onEditResize: (uid, h) => {
      const r = board() && rects().get(uid);
      if (disposed || !r) return;
      // Preview only: the card's live height grows the section around it while typing; nothing is written.
      liveRects = new Map();
      if (h > r.h) liveRects.set(uid, { ...r, h });
      previewFit([uid]);
    },
    onOpenBoard: (uid) => { void openBoard(uid); },
    onRenameBoard: (uid, title) => session.renameBoard?.(uid, title),
    onRenamePage: (from, to) => {
      const n = Number(host?.pageRefCount?.(from)) || 0;
      const go = () => host?.renamePage?.(from, to);
      if (!pageRenameNeedsConfirm(n)) return go();
      chrome.toast.show({
        message: `${n} blocks link to ${from}. Rename it to ${to}?`,
        action: { label: "Rename", run: () => { void go(); } },
      });
      return false;
    },
    onBadgeClick: (uid) => { ctl.select([uid]); panel.open("related"); },
    bt,
    onTaskChip: (uid, kind, anchor) => taskPop.open(uid, kind, anchor),
    onPageLayout: (uid) => { if (blockCards.has(uid)) scheduleAnchors(); },
    onToast: (message) => chrome.toast.show({ message }),
    pdfChips: (item) => pdfChipsFor(item),
    onPdfPulse: (uids) => { for (const uid of uids || []) pulseItem(uid); },
    onPdfOpen: (uid, page) => { void itemsR.openPdfAt?.(uid, page); },
    onEmbedOpen: () => closeOutlineLive(),
    onHighlightOpen: (item, opts) => openHighlightAs(item, opts?.mode),
    onHighlightMenu: (item, anchor) => openHighlightMenu(item, anchor),
    onHighlightNote: (uid) => { void openHighlightNote(uid); },
    interopOn: () => readSetting("interop") !== false,
    coverImage: (url) => coverImageFor(url),
    pdfMetaTitle: (url) => notePdfMeta(url),
    readingUid: () => readingCard,
    onPdfOpenRequest: (uid) => { try { itemsR.openPdf?.(uid); } catch { /* host */ } },
    // Parse opens the reader on the card's page (page 1 unless the card was flipped), so the outline starts at
    // the top instead of at the last page Roam remembered. A reader already on this card keeps its page.
    onPdfParse: (uid) => {
      const already = readPane?.isOpen?.() === true && readPane?.cardUid?.() === uid;
      if (already) { try { itemsR.openPdf?.(uid); } catch { /* host */ } }
      else { try { void itemsR.openPdfAt?.(uid, pdfFlip?.pageOf?.(uid) || 1); } catch { /* host */ } }
      try { ensureReadPane().parse?.(); } catch { /* pane */ }
    },
    pdfCardPage: (uid) => pdfFlip?.pageOf?.(uid) || 1,
    onHighlightHover: (uid, on) => { try { flashPaneMarks(uid, on); } catch { /* pane */ } },
    onPinOpen: (pinUid, event) => openPinFromChip(pinUid, event),
    onReadPane: (detail) => {
      if (!detail?.open) {
        readPane?.close?.({ notify: false });
        if (!disposed) armCoverWarmLater(700, { replace: true });
        return;
      }
      try { pdfWarm?.cancelAll?.(); } catch { /* warm */ }
      let cover = null;
      try { cover = detail.source ? host?.pdfCover?.(detail.source) : null; } catch { cover = null; }
      ensureReadPane().open?.({
        cardUid: detail.cardUid || "",
        blockUid: detail.blockUid,
        page: detail.page,
        highlightUid: detail.highlightUid,
        title: pdfDisplayTitle(board()?.items.get(detail.cardUid || "") || { string: detail.source || "" }, detail.source || ""),
        source: detail.source || "",
        pageUid: cover?.pageUid || "",
      });
      // The board area just narrowed. Keep the PDF's card in view beside its reader.
      const cardUid = detail.cardUid || "";
      timers.frame(() => {
        if (disposed || !cardUid) return;
        measure();
        const r = rects().get(cardUid);
        if (!r) return;
        // centerOn uses the whole root; the board area now ends where the pane begins. The viewport is still
        // sliding to its new edge here, so the width comes from the pane's own box (offsets ignore its slide-in).
        const paneEl = readPane?.element?.();
        const beside = !root.classList.contains("pxd-root--read-stack") && paneEl?.offsetLeft > 0;
        const w = beside ? paneEl.offsetLeft : (Number(root.querySelector?.(".pxd-viewport")?.getBoundingClientRect?.()?.width) || size.width);
        const y = size.height / 2 - (r.y + r.h / 2) * vp.zoom;
        moveViewport({ x: w / 2 - (r.x + r.w / 2) * vp.zoom, y, zoom: vp.zoom });
      });
    },
  });
  itemsReady = true;
  // The pane, its DOM and its listeners exist only once a PDF is opened. Most boards have no PDF.
  const ensureReadPane = () => {
    if (readPane) return readPane;
    readPane = makeReadPane();
    try { readPane?.layout?.(size.width); } catch { /* first layout on the next resize */ }
    return readPane;
  };
  function openPin(detail) {
    const plan = detail && typeof detail === "object" ? detail : null;
    const pdfUid = plan?.pdfUid || "";
    const b = board();
    if (disposed || !b || !pdfUid) return false;
    let item = null;
    for (const it of b.items.values()) {
      if (!it || it.kind !== "pdf") continue;
      const blockUid = it.target?.kind === "block" ? it.target.uid : it.uid;
      if (it.uid === pdfUid || blockUid === pdfUid || it.target?.uid === pdfUid) { item = it; break; }
    }
    if (!item) return false;
    const blockUid = item.target?.kind === "block" ? item.target.uid : item.uid;
    ensureReadPane().open?.({
      cardUid: item.uid,
      blockUid,
      page: plan.page,
      frac: plan.frac,
      source: item.string || "",
      title: pdfDisplayTitle(item),
    });
    return true;
  }
  openPinFromChip = (pinUid, event) => {
    let text = "";
    try { text = host?.blockString?.(pinUid) || ""; } catch { text = ""; }
    const region = parseRegion(text);
    if (!region) return false;
    region.uid = pinUid;
    const plan = pinOpenPlan(region);
    if (!plan) return false;
    if (event?.shiftKey) {
      try { host?.openInSidebar?.(plan.pdfUid); } catch { /* host */ }
      return true;
    }
    return openPin(plan);
  };
  let parseActionsObj = null;
  const revealParsed = (uids) => {
    const uid = Array.isArray(uids) ? uids.find((id) => typeof id === "string" && id) : "";
    if (!uid || disposed) return;
    const run = (left) => {
      if (disposed) return;
      try { measure(); } catch { /* layout */ }
      const rect = rects().get(uid);
      if (!rect) {
        if (left > 0) timers.frame(() => run(left - 1));
        return;
      }
      const box = size.width && size.height ? size : { width: 800, height: 560 };
      const next = panToShow(vp, box, rect, { pad: 24 });
      if (next.moved) moveViewport({ x: next.x, y: next.y, zoom: next.zoom });
      if (itemsR.shellOf?.(uid)) pulseItem(uid);
      else if (left > 0) timers.frame(() => { if (!disposed) pulseItem(uid); });
    };
    timers.frame(() => run(8));
  };
  const placeParseBeside = (pdfUid, sz) => {
    const items = [...(board()?.items.values() || [])];
    const rs = rects();
    const rectOf = (it) => rs.get(it.uid) || { x: it.x, y: it.y, w: it.w, h: it.h };
    const card = board()?.items.get(pdfUid) || board()?.items.get(readPane?.cardUid?.() || "");
    if (card) return freeSpotBeside(rectOf(card), sz, items.filter((it) => it !== card).map(rectOf));
    const c = screenToWorld(vp, { x: size.width / 2, y: size.height / 2 });
    return { x: c.x - (sz?.w || 0) / 2, y: c.y - (sz?.h || 0) / 2 };
  };
  // A reader → board insert leaves focus in the reader, whose keys belong to Roam, so ⌘Z undid only the
  // last write (the Source:: child). The board root takes focus, without scrolling, so ⌘Z undoes the gesture.
  const focusBoardAfterInsert = () => {
    if (disposed) return;
    if (itemsR?.isEditing?.()) return;
    const active = doc.activeElement;
    if (active && active !== doc.body && !active.closest?.(".pxd-read") && !root.contains?.(active) && isTextEntryTarget(active)) return;
    try { root.focus({ preventScroll: true }); } catch { /* stub */ }
  };
  const parseActions = () => {
    if (!parseActionsObj) {
      parseActionsObj = createParseActions({
        session,
        store: createParseStore({ indexedDB: doc.defaultView?.indexedDB }),
        placeBeside: placeParseBeside,
        toWorld: (pt) => { measure(); return screenToWorld(vp, { x: pt.x - rootRect.left, y: pt.y - rootRect.top }); },
        toast: (message) => toast(message),
        select: (uids) => { if (!disposed) ctl.select(uids); },
        show: (uids) => { if (!disposed) revealParsed(uids); },
        focus: () => focusBoardAfterInsert(),
        upload: (file) => host.uploadFile?.(file),
      });
    }
    return parseActionsObj;
  };
  const makeReadPane = () => (createReadPane({
    doc,
    root,
    host: readPaneHost(host, (message) => toast(message)),
    deviceOcr: sharedDeviceOcr(),
    onNote: (row) => { void openHighlightNote(row?.uid); },
    graph,
    storage,
    cards: () => [...(board()?.items.values() || [])].filter((it) => it?.kind === "pdf"),
    placed: () => [...(board()?.items.values() || [])],
    titleOf: (card) => pdfDisplayTitle(card),
    coverSrc: (detail) => {
      const url = pdfMacroUrl(detail?.source || "");
      if (!url) return "";
      const face = coverImageFor(url);
      return face?.state === "ready" && face.src ? face.src : "";
    },
    onClose: () => { itemsR?.closeEmbed?.(); },
    onSwitch: (uid) => { itemsR?.openPdf?.(uid); },
    onSnapshot: (liveEl, info) => takeCoverSnapshot(liveEl, info),
    onReadingChange: (uid) => {
      const next = typeof uid === "string" ? uid : "";
      if (next === readingCard) return;
      readingCard = next;
      if (next && !disposed) {
        for (const it of board()?.items.values() || []) {
          if (it?.kind !== "pdf") continue;
          try { pdfDisplayTitle(it); } catch { /* title */ }
        }
      }
      if (!disposed) itemsR.repaintStyles({ highlighter: false });
      if (!disposed) { try { chrome.ctx.reposition(); chrome.toolbar.scheduleDock?.(); } catch { /* chrome */ } }
    },
    onParsedTitle: (url, title, lines) => {
      if (disposed || typeof url !== "string" || !url || !title) return;
      if (Array.isArray(lines)) parsedEvidence.set(url, { pageTitle: title, lines });
      if (parsedTitles.get(url) === title) return;
      parsedTitles.set(url, title);
      try { itemsR?.repaintStyles?.(); } catch { /* paint */ }
      try { readPane?.refreshCards?.(); } catch { /* switcher */ }
    },
    onHover: (uid, on) => {
      if (!on || typeof uid !== "string" || !uid) return;
      for (const item of board()?.items.values() || []) {
        if (item?.target?.uid === uid) pulseItem(item.uid);
      }
    },
    session: parseActions(),
    settings: { get: (id) => readSetting(id) },
    setSetting: (id, value) => (typeof onSetDefaults === "function" ? onSetDefaults({ [id]: value }) : undefined),
    onPlace: (row) => {
      const items = [...(board()?.items.values() || [])];
      const card = board()?.items.get(readPane?.cardUid?.() || "");
      const live = card ? (rects().get(card.uid) || { x: card.x, y: card.y, w: card.w, h: card.h }) : null;
      const decision = placeDecision(row, items, originBeside(live));
      if (decision.kind === "pulse") {
        if (decision.uid) pulseItem(decision.uid);
        return;
      }
      if (decision.kind !== "create") return;
      const made = session.addRefCards?.([decision.item]);
      Promise.resolve(made).then((uids) => {
        if (!disposed && Array.isArray(uids) && uids.length) ctl.select(uids);
      }).catch(() => {});
    },
  }));
  // The header highlight count follows the same signal as the cover-face count: every card repaint re-reads it.
  const rawRepaintStyles = itemsR.repaintStyles.bind(itemsR);
  itemsR.repaintStyles = (...args) => {
    const out = rawRepaintStyles(...args);
    if (!disposed) { try { refreshPdfHighlightCounts(); } catch { /* count */ } }
    return out;
  };
  repaintItemStyles = () => { if (!disposed) itemsR.repaintStyles(); };

  // PDF covers. Nothing here runs at mount: the renderer asks coverImageFor on first paint,
  // and the warm timer arms only when the setting is on.
  const coverWarmOn = () => {
    const v = readSetting("pdf-cover-warm");
    return v === true || v === "true";
  };
  const ensureCoverStore = () => {
    if (coverStore) return coverStore;
    coverStore = createCoverStore({ indexedDB: win?.indexedDB, storage });
    return coverStore;
  };
  const warmTimers = {
    setTimeout: (fn, ms) => (typeof win?.setTimeout === "function" ? win.setTimeout(fn, ms) : setTimeout(fn, ms)),
    clearTimeout: (id) => (typeof win?.clearTimeout === "function" ? win.clearTimeout(id) : clearTimeout(id)),
  };
  // P32-2. pdf.js is probed once per view, when the first warm is needed: Roam's own build, if it is a
  // global with a worker configured, draws page 1 without a reader. Otherwise the hidden mount does.
  let firstPage = null;
  let pdfjsProbe = null;
  let pdfMeta = null;
  // A probe that found no usable pdf.js is not final: Roam may load it later, so the next call looks again.
  const probePdfjs = () => {
    if (pdfjsProbe && firstPage) return pdfjsProbe;
    const found = detectPdfjs(win);
    pdfjsProbe = { found: Boolean(found), key: found?.key || "", version: found?.version || "", workerReady: Boolean(found?.workerReady) };
    if (found && found.workerReady) {
      firstPage = createFirstPageRenderer({ doc, lib: found.lib, timers: warmTimers });
      pdfMeta = createPdfMetaLookup({ lib: found.lib });
    }
    return pdfjsProbe;
  };
  const aliasOfCard = (card) => {
    const title = typeof card?.title === "string" ? card.title.trim() : "";
    if (!title || title === "PDF" || title.startsWith("{{") || title.startsWith("((")) return "";
    return title;
  };
  const textOfCard = (card, src) => {
    const raw = typeof card?.string === "string" ? card.string.trim() : "";
    const body = raw || (typeof src === "string" ? src.trim() : "");
    if (!body || body.startsWith("{{") || body.startsWith("((")) return "";
    return body;
  };
  // A PDF parsed before (any session) names itself from the cache, so the switcher and the cards show
  // its title without opening it. IndexedDB only; nothing is parsed or fetched.
  const storedQueued = new Set();
  let titleStore = null;
  const noteStoredTitle = (key) => {
    if (storedQueued.has(key)) return;
    storedQueued.add(key);
    if (!titleStore) titleStore = createParseStore({ indexedDB: doc.defaultView?.indexedDB });
    restorableByUrl(titleStore, key, { plainOptions: BUILTIN_OPTIONS }).then((found) => {
      const title = found ? parsedDocTitle(found) : "";
      if (disposed || !title || parsedTitles.get(key)) return;
      parsedTitles.set(key, title);
      parsedEvidence.set(key, { pageTitle: title, lines: parsedTitleLines(found) });
      try { itemsR?.repaintStyles?.(); } catch { /* paint */ }
      try { readPane?.refreshCards?.(); } catch { /* switcher */ }
    }).catch(() => {});
  };
  const metaQueued = new Set();
  let metaTail = Promise.resolve();
  // The title the cover warm read from page 1, when no parse names the PDF.
  const warmTitleOf = (key) => {
    const face = coverFaces.get(key);
    const title = typeof face?.pageTitle === "string" ? cleanPdfTitle(face.pageTitle) : "";
    return title ? { pageTitle: title, lines: face.titleLines || [] } : null;
  };
  notePdfMeta = (url) => {
    const key = typeof url === "string" ? url.trim() : "";
    if (!key) return "";
    const parsedOnly = parsedTitles.get(key) || "";
    if (!parsedOnly) noteStoredTitle(key);
    const warm = parsedOnly ? null : warmTitleOf(key);
    const parsedKnown = parsedOnly || warm?.pageTitle || "";
    const evidence = parsedOnly ? parsedEvidence.get(key) : warm;
    try { probePdfjs(); } catch { return parsedKnown; }
    if (!pdfMeta) return parsedKnown;
    const meta = cleanPdfTitle(pdfMeta.title(key));
    // A metadata Title that only repeats the journal banner of page 1 loses to the page's own title.
    const banner = meta && parsedKnown && isMetaBanner(meta, { pageTitle: parsedKnown, lines: evidence?.lines || [] });
    const known = (banner ? "" : meta) || parsedKnown;
    if (!known && !metaQueued.has(key)) {
      metaQueued.add(key);
      const meta = pdfMeta;
      const job = metaTail.then(() => meta.want(key)).catch(() => "");
      metaTail = job.then(() => {}, () => {});
      job.then((got) => {
        if (disposed || !got) return;
        try { itemsR?.repaintStyles?.(); } catch { /* paint */ }
        try {
          if (readPane?.isOpen?.() !== true) return;
          const card = board()?.items.get(readPane.cardUid?.() || "");
          if (card && typeof readPane.setTitle === "function") readPane.setTitle(pdfDisplayTitle(card));
          readPane.refreshCards?.();
        } catch { /* title */ }
      });
    }
    return known;
  };
  pdfDisplayTitle = (card, source) => {
    const src = typeof source === "string" && source ? source : pdfSourceOfItem(card);
    const url = pdfMacroUrl(src);
    const metadataTitle = url ? notePdfMeta(url) : "";
    let cover = null;
    try { cover = src ? host?.pdfCover?.(src) : null; } catch { cover = null; }
    return coverModel({
      metadataTitle,
      alias: aliasOfCard(card),
      text: textOfCard(card, src),
      title: typeof cover?.title === "string" ? cover.title : "",
      url: (typeof cover?.url === "string" && cover.url) || url,
      count: cover?.count,
    }).title;
  };
  const ensurePdfWarm = () => {
    if (pdfWarm) return pdfWarm;
    probePdfjs();
    pdfWarm = createPdfWarm({
      doc,
      root,
      host,
      store: ensureCoverStore(),
      timers: warmTimers,
      // Looked up per call: pdf.js may turn up after the warm was made. No renderer yet reads as busy for a
      // title (nothing is stored) and as no image for a cover (the hidden reader draws it).
      renderFirst: (spec) => {
        if (!firstPage) return spec?.titleOnly ? { busy: true } : null;
        return spec?.titleOnly && firstPage.busy() ? { busy: true } : firstPage.render(spec);
      },
    });
    return pdfWarm;
  };
  const coverReport = () => ({
    on: coverWarmOn(),
    pdfjs: pdfjsProbe || { found: null },
    firstPage: firstPage ? firstPage.report() : null,
    warm: pdfWarm ? pdfWarm.report() : null,
    why: warmWhy,
    titles: [...coverFaces.entries()].map(([url, face]) => ({
      url: url.slice(-12),
      state: face?.state || "",
      title: typeof face?.pageTitle === "string" ? face.pageTitle.slice(0, 60) : null,
      stale: face?.titleStale === true,
      tries: titleTries.get(url) || 0,
    })),
  });
  const pdfBlockUid = (item) => {
    if (item?.target?.kind === "block" && typeof item.target.uid === "string" && item.target.uid) return item.target.uid;
    return typeof item?.uid === "string" ? item.uid : "";
  };
  const coverUrlOf = (item) => coverKey(pdfMacroUrl(pdfSourceOfItem(item)));
  const wholePage = (value) => {
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 ? n : null;
  };
  const rowsForCover = (url) => {
    const key = coverKey(url);
    if (!key) return [];
    const rows = [];
    for (const other of board()?.items.values() || []) {
      if (other?.kind !== "highlight" || !other.target?.uid) continue;
      let pageUid = "";
      let pageUrl = "";
      try { pageUid = host?.blockPageUid?.(other.target.uid) || ""; } catch { pageUid = ""; }
      try { pageUrl = pageUid ? (host?.pdfPageUrl?.(pageUid) || "") : ""; } catch { pageUrl = ""; }
      if (coverKey(pageUrl) !== key) continue;
      rows.push({ page: other.highlight?.page, color: other.highlight?.color || "", highlight: other.highlight });
    }
    return rows;
  };
  const ticksFor = (url, pageCount) => {
    const rows = rowsForCover(url);
    const ticks = densityTicks(rows, pageCount);
    const total = Number(pageCount);
    const pages = [];
    for (const row of rows) {
      const page = wholePage(row?.page) || wholePage(row?.highlight?.page);
      if (!page || !Number.isInteger(total) || total < 1 || page > total) continue;
      pages.push(page);
    }
    return ticks.map((tick, i) => (pages[i] != null ? { ...tick, page: pages[i] } : tick));
  };
  const sharpStore = createSharpStore({ revoke: (src) => globalThis.URL?.revokeObjectURL?.(src), later: (fn, ms) => timers.later(fn, ms) });
  const sharpFaces = { get: (url) => sharpStore.get(url) };
  let sharpTimer = null;
  const sharpOf = (url, face) => {
    const sharp = sharpFaces.get(url);
    if (!sharp?.src || !(Number(sharp.w) > Number(face?.w || 0))) return face;
    return {
      ...face,
      state: face?.state === "loading" || !face?.state ? "ready" : face.state,
      src: sharp.src,
      w: sharp.w,
      h: sharp.h ?? face?.h ?? null,
    };
  };
  const presentFace = (url, face) => {
    if (!face || face.state === "loading") return sharpOf(url, { state: "loading", w: face?.w ?? null });
    return sharpOf(url, {
      state: face.state,
      src: face.src || "",
      w: face.w ?? null,
      h: face.h ?? null,
      ticks: ticksFor(url, face.pageCount),
      lastPage: face.lastPage ?? null,
      pageCount: face.pageCount ?? null,
    });
  };
  const imageOfCover = (record) => {
    if (!record || typeof record !== "object") return null;
    const last = readSetting("pdf-cover") === "last-read";
    const primary = last ? record.last : record.first;
    const fallback = last ? record.first : record.last;
    return primary || fallback || null;
  };
  const uidForCoverUrl = (url) => {
    const key = coverKey(url);
    if (!key) return "";
    for (const item of board()?.items.values() || []) {
      if (item?.kind === "pdf" && coverUrlOf(item) === key) return item.uid;
    }
    return "";
  };
  const titleFace = (record) => ({
    pageTitle: typeof record?.pageTitle === "string" ? record.pageTitle : null,
    titleStale: record?.titleStale === true,
    titleLines: Array.isArray(record?.titleLines) ? record.titleLines : [],
  });
  const emptyFace = (state, record) => ({
    state: state === "ready" ? "none" : state,
    src: "",
    w: record?.w ?? null,
    h: record?.h ?? null,
    lastPage: record?.lastPage ?? null,
    pageCount: record?.pageCount ?? null,
    ...titleFace(record),
  });
  const srcOfCover = async (image) => {
    if (typeof image === "string") return image.startsWith("data:") ? image : "";
    const data = await blobToDataUrl(image);
    return typeof data === "string" && data.startsWith("data:") ? data : "";
  };
  const loadCover = (url) => {
    const gen = (coverGen.get(url) || 0) + 1;
    coverGen.set(url, gen);
    coverFaces.set(url, { state: "loading" });
    let pending = null;
    try { pending = ensureCoverStore().get(url); } catch { pending = Promise.resolve(null); }
    Promise.resolve(pending).then(async (record) => {
      if (disposed || coverGen.get(url) !== gen) return;
      const image = imageOfCover(record);
      if (!image) {
        const warm = pdfWarm ? pdfWarm.outcome(uidForCoverUrl(url)) : "idle";
        coverFaces.set(url, emptyFace(coverState(null, warm), record));
      } else {
        const src = await srcOfCover(image);
        if (disposed || coverGen.get(url) !== gen) return;
        coverFaces.set(url, src
          ? { state: "ready", src, w: record?.w ?? null, h: record?.h ?? null, lastPage: record?.lastPage ?? null, pageCount: record?.pageCount ?? null, ...titleFace(record) }
          : emptyFace("error", record));
      }
      if (!disposed) itemsR.repaintStyles();
      if (!disposed && typeof record?.pageTitle === "string" && record.pageTitle) {
        try { readPane?.refreshCards?.(); } catch { /* switcher */ }
      }
      scheduleSharpCovers();
    }).catch(() => {
      if (disposed || coverGen.get(url) !== gen) return;
      coverFaces.set(url, emptyFace("none", null));
      if (!disposed) itemsR.repaintStyles();
    });
  };
  const coverImageFor = (url) => {
    const key = coverKey(url);
    if (!key) return null;
    const face = coverFaces.get(key);
    const sharp = sharpFaces.get(key);
    if (face?.state === "loading") {
      if (sharp?.src) return { state: "ready", src: sharp.src, w: sharp.w, h: sharp.h ?? null };
      return { state: "loading" };
    }
    if (face) return presentFace(key, face);
    loadCover(key);
    if (sharp?.src) return { state: "ready", src: sharp.src, w: sharp.w, h: sharp.h ?? null };
    return { state: "loading" };
  };
  const refreshSharpCovers = () => {
    sharpTimer = null;
    if (disposed || gesturing) return;
    try { probePdfjs(); } catch { return; }
    if (!firstPage) return;
    if (firstPage.busy()) {
      sharpTimer = timers.later(() => refreshSharpCovers(), 400);
      return;
    }
    const dpr = Number(win?.devicePixelRatio) > 0 ? Number(win.devicePixelRatio) : 1;
    const zoom = Number(vp?.zoom) > 0 ? Number(vp.zoom) : 1;
    let picked = null;
    for (const item of board()?.items.values() || []) {
      if (!item || item.kind !== "pdf" || item.collapsed) continue;
      const url = coverUrlOf(item);
      if (!url || !firstPageAllowed(url)) continue;
      const rect = rects().get(item.uid);
      if (!rect) continue;
      const sharp = sharpFaces.get(url);
      const stored = coverFaces.get(url);
      const coverW = sharp?.w || stored?.w || COVER_MAX_W;
      const plan = sharpCoverPlan({ cardW: rect.w, zoom, dpr, coverW });
      if (!plan) continue;
      picked = { url, maxW: plan.maxW };
      break;
    }
    if (!picked) return;
    const token = sharpStore.begin(picked.url);
    Promise.resolve(firstPage.render({ url: picked.url, maxW: picked.maxW, title: false })).then((result) => {
      if (disposed) return;
      if (!sharpStore.current(picked.url, token)) return;
      if (!result?.blob || typeof globalThis.URL?.createObjectURL !== "function") {
        sharpStore.fail(picked.url, token, picked.maxW);
        scheduleSharpCovers();
        return;
      }
      let src = "";
      try { src = globalThis.URL.createObjectURL(result.blob); } catch { src = ""; }
      if (!src) {
        sharpStore.fail(picked.url, token, picked.maxW);
        scheduleSharpCovers();
        return;
      }
      // Record the size we asked for. A render that comes back smaller must not
      // be queued again, or each new blob rebuilds the card and drops the flipper.
      const drawn = Number(result.w) > 0 ? Number(result.w) : 0;
      if (!sharpStore.commit(picked.url, token, { src, w: Math.max(drawn, picked.maxW), h: result.h || 0, failed: false })) return;
      try { itemsR?.repaintStyles?.(); } catch { /* paint */ }
      try { syncPdfFlip?.(); } catch { /* flip follows the new paper */ }
      scheduleSharpCovers();
    }).catch(() => {
      if (disposed) return;
      if (sharpStore.fail(picked.url, token, picked.maxW)) scheduleSharpCovers();
    });
  };
  const scheduleSharpCovers = () => {
    if (disposed || sharpTimer) return;
    sharpTimer = timers.later(() => {
      sharpTimer = null;
      if (disposed || gesturing) return;
      refreshSharpCovers();
    }, 250);
  };
  const dropCover = (url) => {
    const key = coverKey(typeof url === "string" ? url : "");
    if (!key) return;
    coverFaces.delete(key);
    coverGen.set(key, (coverGen.get(key) || 0) + 1);
    if (!disposed) itemsR.repaintStyles();
  };
  // A title-only pass leaves the images alone: merge the new title into the ready face so the cover stays
  // painted (dropCover would show the skeleton until the store read finishes).
  const refreshCoverTitle = (url, record) => {
    const face = coverFaces.get(url);
    if (disposed || !face || face.state !== "ready" || !record) return false;
    coverFaces.set(url, { ...face, ...titleFace(record) });
    itemsR.repaintStyles();
    if (typeof record.pageTitle === "string" && record.pageTitle) {
      try { readPane?.refreshCards?.(); } catch { /* switcher */ }
    }
    return true;
  };
  const forgetCovers = () => {
    const keys = new Set([...coverFaces.keys(), ...coverGen.keys()]);
    coverFaces.clear();
    for (const key of keys) coverGen.set(key, (coverGen.get(key) || 0) + 1);
  };
  const clearFlashedMarks = () => {
    for (const node of flashedMarks) node.classList?.remove("pxd-read__mark-flash");
    flashedMarks.length = 0;
  };
  // flashParts lives inside the pane and scrolls. Hover only toggles the same class.
  const flashPaneMarks = (highlightUid, on) => {
    clearFlashedMarks();
    if (!on || typeof highlightUid !== "string" || !highlightUid) return;
    if (readPane?.isOpen?.() !== true) return;
    const card = board()?.items.get(readPane.cardUid?.() || "");
    if (!card || card.kind !== "pdf") return;
    const pdfUrl = coverUrlOf(card);
    if (!pdfUrl) return;
    let pageUid = "";
    let pageUrl = "";
    try { pageUid = host?.blockPageUid?.(highlightUid) || ""; } catch { pageUid = ""; }
    try { pageUrl = pageUid ? (host?.pdfPageUrl?.(pageUid) || "") : ""; } catch { pageUrl = ""; }
    if (coverKey(pageUrl) !== pdfUrl) return;
    const live = root.querySelector?.(".pxd-read__live");
    const nodes = live?.querySelectorAll?.(PDF_MARK) || [];
    for (const node of nodes) {
      let found = null;
      try { found = uidFromMark(node); } catch { found = null; }
      if (found?.uid !== highlightUid) continue;
      node.classList?.add("pxd-read__mark-flash");
      flashedMarks.push(node);
    }
  };
  const readerIsLive = () => {
    try {
      if (readPane?.isOpen?.() === true) return true;
      if (pdfFlip?.live?.()) return true;
      const nodes = root.querySelectorAll?.(".rm-pdf-container") || [];
      for (const node of nodes) {
        if (typeof node.closest === "function" && node.closest(".pxd-pdf-warm, .pxd-read")) continue;
        return true;
      }
    } catch { /* stub */ }
    return false;
  };
  const saveDataOn = () => {
    try { return win?.navigator?.connection?.saveData === true; } catch { return false; }
  };
  const coverHashOf = (item) => {
    try {
      const cover = host?.pdfCover?.(pdfSourceOfItem(item));
      return typeof cover?.hash === "string" ? cover.hash.trim() : "";
    } catch { return ""; }
  };
  let warmWhy = "";
  // Title reads per url: real reads only (a busy renderer is not a try), at most TITLE_TRIES_MAX per view,
  // spaced by TITLE_BACKOFF_MS × 2^(tries − 1).
  const titleTries = new Map();
  const titleNextAt = new Map();
  const TITLE_TRIES_MAX = 3;
  const TITLE_BACKOFF_MS = 3000;
  const titleAsks = new Map();
  const TITLE_ASKS_MAX = 12;
  // Nothing to warm yet but work is pending (covers still loading, a title waiting on backoff or on a busy
  // renderer): look again after IDLE_RETRY_MS × 2^n, at most IDLE_RETRY_MAX times in a row.
  let idleRetries = 0;
  const IDLE_RETRY_MS = 1000;
  const IDLE_RETRY_MAX = 6;
  // `anyRenderer`: wanted once pdf.js turns up (counts as pending work, so the look is repeated, boundedly).
  const titleWanted = (url, { anyRenderer = false } = {}) => {
    const face = coverFaces.get(url);
    if (face?.state !== "ready") return false;
    if (typeof face.pageTitle === "string" && face.titleStale !== true) return false;
    return !parsedTitles.get(url) && (anyRenderer || Boolean(firstPage)) && firstPageAllowed(url) && (titleTries.get(url) || 0) < TITLE_TRIES_MAX;
  };
  const considerCoverWarm = () => {
    warmWhy = "off";
    if (disposed || suspended || !coverWarmOn() || !coverPaintAt) return;
    const since = Date.now() - coverPaintAt;
    if (since < WARM_AFTER_MS) { warmWhy = "early"; armCoverWarm(); return; }
    if (gesturing) { warmWhy = "gesture"; return; }
    try { probePdfjs(); } catch { /* no renderer */ }
    const cards = [];
    const visible = new Set();
    const view = size.width ? visibleWorldRect(vp, size, 0) : null;
    const r = rects();
    const now = Date.now();
    let pending = 0;
    for (const item of board()?.items.values() || []) {
      if (item?.kind !== "pdf") continue;
      const url = coverUrlOf(item);
      const blockUid = pdfBlockUid(item);
      if (!url || !blockUid) continue;
      const rect = r.get(item.uid);
      if (view && rect && rectsIntersect(rect, view)) visible.add(item.uid);
      // A card never painted has no face yet: read its cover record (IndexedDB only) so its title can be checked.
      if (!coverFaces.has(url)) { loadCover(url); pending += 1; }
      else if (coverFaces.get(url)?.state === "loading") pending += 1;
      const wanted = titleWanted(url);
      const due = now >= (titleNextAt.get(url) || 0);
      if (wanted ? !due : titleWanted(url, { anyRenderer: true })) pending += 1;
      cards.push({
        uid: item.uid,
        blockUid,
        kind: "pdf",
        hasCover: coverFaces.get(url)?.state === "ready",
        needsTitle: wanted && due,
        url,
        item,
      });
    }
    let plan = null;
    try {
      plan = warmPlan({
        cards,
        visible,
        hasLive: readerIsLive() || Boolean(pdfFlip?.live?.()),
        hasPane: readPane?.isOpen?.() === true,
        sinceOpenMs: since,
        done: pdfWarm ? pdfWarm.spent() : 0,
        inFlight: pdfWarm ? pdfWarm.running() : false,
        saveData: saveDataOn(),
        moving: gesturing,
        offscreenTitles: true,
      });
    } catch { plan = null; }
    if (!plan || gesturing) {
      const titles = cards.filter((c) => c.needsTitle).length;
      warmWhy = `no plan: ${cards.length} cards, ${visible.size} visible, ${cards.filter((c) => c.hasCover).length} covered, ${titles} need a title, ${pending} pending, retry ${idleRetries}`;
      if ((pending || titles) && !gesturing && idleRetries < IDLE_RETRY_MAX) {
        const wait = IDLE_RETRY_MS * 2 ** idleRetries;
        idleRetries += 1;
        armCoverWarmLater(wait);
      }
      return;
    }
    idleRetries = 0;
    const picked = cards.find((row) => row.uid === plan.uid);
    if (!picked) return;
    // The cover hash is read for the one card that warms (host.pdfCover is a graph read).
    const { item: pickedItem, ...card } = picked;
    const hash = coverHashOf(pickedItem);
    if (hash) card.hash = hash;
    warmWhy = `warm ${card.uid}${card.needsTitle ? " (title)" : ""}`;
    // Idle first: the warm waits for a quiet frame (at most 2 s), and a gesture that started meanwhile wins.
    const start = () => {
      if (disposed || suspended) return;
      if (gesturing || readPane?.isOpen?.() === true || pdfFlip?.live?.()) {
        armCoverWarmLater(600);
        return;
      }
      // A title-only pass waits for the shared renderer (a sharp cover may hold it) instead of spending a try.
      if (card.needsTitle && card.hasCover && firstPage?.busy?.()) {
        warmWhy = `renderer busy for ${card.uid}`;
        armCoverWarmLater(600);
        return;
      }
      const triedBefore = firstPage ? Number(firstPage.report().tried) || 0 : 0;
      let job = null;
      try { job = ensurePdfWarm().request(card); } catch { job = null; }
      const next = () => {
        // One PDF at a time: when a job ends, look again for the next visible PDF without a cover.
        if (disposed || suspended) return;
        if (coverWarmWait) { coverWarmWait(); coverWarmWait = null; }
        coverWarmWait = timers.later(() => { coverWarmWait = null; considerCoverWarm(); }, 400);
      };
      Promise.resolve(job).then((record) => {
        if (disposed) return;
        const face = coverFaces.get(card.url);
        const tried = firstPage ? (Number(firstPage.report().tried) || 0) > triedBefore : false;
        if (card.needsTitle && tried) {
          const n = (titleTries.get(card.url) || 0) + 1;
          titleTries.set(card.url, n);
          titleNextAt.set(card.url, Date.now() + TITLE_BACKOFF_MS * 2 ** (n - 1));
        } else if (card.needsTitle) {
          // Asked but nothing was read (busy, superseded): no try is spent, but the asks are bounded too.
          const asks = (titleAsks.get(card.url) || 0) + 1;
          titleAsks.set(card.url, asks);
          if (asks >= TITLE_ASKS_MAX) titleTries.set(card.url, TITLE_TRIES_MAX);
          else titleNextAt.set(card.url, Date.now() + 1000);
        }
        if (record && face?.state === "ready" && card.hasCover) refreshCoverTitle(card.url, record);
        else if (record || face?.state !== "ready") dropCover(card.url);
        next();
      }).catch(() => next());
    };
    if (typeof win?.requestIdleCallback === "function") {
      try { win.requestIdleCallback(() => start(), { timeout: 2000 }); return; } catch { /* fall through */ }
    }
    start();
  };
  const armCoverWarmLater = (ms, { replace = false } = {}) => {
    if (disposed || suspended || !coverWarmOn() || !coverPaintAt) return;
    if (coverWarmWait) {
      if (!replace) return;
      coverWarmWait();
      coverWarmWait = null;
    }
    coverWarmWait = timers.later(() => {
      coverWarmWait = null;
      considerCoverWarm();
    }, ms);
  };
  const armCoverWarm = () => {
    if (coverWarmWait) { coverWarmWait(); coverWarmWait = null; }
    if (disposed || suspended || !coverWarmOn() || !coverPaintAt) return;
    const wait = Math.max(0, WARM_AFTER_MS - (Date.now() - coverPaintAt));
    coverWarmWait = timers.later(() => {
      coverWarmWait = null;
      considerCoverWarm();
    }, wait);
  };
  const takeCoverSnapshot = (liveEl, info) => {
    const spec = info && typeof info === "object" ? info : {};
    const settle = spec.as === "settle";
    let job = null;
    try {
      job = ensurePdfWarm().snapshotFrom(liveEl, {
        page: settle ? 1 : spec.page,
        url: spec.url,
        pageCount: spec.pageCount,
        as: settle ? "first" : "last",
      });
    } catch { job = null; }
    Promise.resolve(job).then(() => {
      if (!disposed) dropCover(spec.url);
    }).catch(() => {
      if (!disposed) dropCover(spec.url);
    });
  };
  const taskPop = createTaskPopover({ doc, root, bt, toast: (m) => chrome.toast.show(m) });
  const taskDone = createTaskCompleter({ doc, getRoot: () => root, host, bt, win });
  let betterTasksOn = false;
  const taskCardUids = () => {
    const b = board();
    if (!b) return [];
    return [...b.items.values()].filter((it) => it.type === "card" && it.kind === "note" && isTaskString(it.string)).map((it) => it.uid);
  };
  const applyTaskSettings = () => {
    const on = readSetting("better-tasks") === true;
    if (!on) {
      itemsR.setTaskChips("none");
      // Bodies mounted while the integration was on keep the light checkbox until they rebuild.
      if (betterTasksOn) {
        betterTasksOn = false;
        const uids = taskCardUids();
        if (uids.length) { itemsR.expireContent(uids); scheduleContent(); }
      }
      return;
    }
    itemsR.setTaskChips(String(setting("task-chips", "full")));
    if (betterTasksOn) return;
    betterTasksOn = true;
    // Attribute labels can be renamed in Better Tasks: once it answers, redraw the task cards that read them.
    void bt.prime().then((names) => {
      if (!names || disposed || readSetting("better-tasks") !== true) return;
      setTaskAttrNames(names);
      const uids = taskCardUids();
      if (uids.length) { itemsR.expireContent(uids); scheduleContent(); }
    });
  };
  applyTaskSettings();
  const edgesR = createEdgeLayer({
    doc,
    svg: edgesSvg,
    labelsLayer,
    overlaySvg,
    onLabelCommit: (uid, label) => session.updateEdge?.(uid, { label }),
    blockText: (uid) => host?.blockString?.(uid),
    onHover: (uid, on) => hoverRows(uid, on),
  });

  // NAV-3 / MEM-8. Queries run when Info opens or a lens turns on, not while the board is mounting.
  const timelineTargetUid = (item) => {
    if (!item || item.type === "section" || item.type === "text") return "";
    if (item.target?.kind === "page") {
      try { return host?.pageUid?.(item.target.title) || ""; } catch { return ""; }
    }
    if (item.target?.uid) return item.target.uid;
    return item.uid || "";
  };
  const timelineIds = () => {
    const ids = [];
    const seen = new Set();
    const add = (id) => {
      const s = String(id || "").trim();
      if (!s || seen.has(s)) return;
      seen.add(s);
      ids.push(s);
    };
    add(board()?.uid || boardUid);
    const b = board();
    if (b) for (const item of b.items.values()) if (item?.type === "card") add(timelineTargetUid(item));
    return ids;
  };
  const loadTimelineRows = () => {
    const uid = board()?.uid || boardUid;
    if (timelineRows && timelineCacheUid === uid) return Promise.resolve(timelineRows);
    if (timelinePending && timelinePendingUid === uid) return timelinePending;
    const ids = timelineIds();
    if (!ids.length || typeof host?.q !== "function") return Promise.resolve(timelineRows || []);
    const spec = timelineQuery(ids);
    let job;
    try {
      job = Promise.resolve(host.q(spec.query, ...spec.args)).then((rows) => {
        const list = Array.isArray(rows) ? rows : [];
        if (!disposed && (board()?.uid || boardUid) === uid) {
          timelineRows = list;
          timelineCacheUid = uid;
        }
        return list;
      }).catch(() => []);
    } catch {
      return Promise.resolve([]);
    }
    timelinePending = job;
    timelinePendingUid = uid;
    const clear = () => {
      if (timelinePending === job) {
        timelinePending = null;
        timelinePendingUid = "";
      }
    };
    job.then(clear, clear);
    return job;
  };
  const aliasTimelineRows = (rows) => {
    const list = Array.isArray(rows) ? rows : [];
    const b = board();
    if (!b) return list;
    const byTarget = new Map();
    for (const item of b.items.values()) {
      if (item?.type !== "card") continue;
      const target = timelineTargetUid(item);
      if (!target) continue;
      if (!byTarget.has(target)) byTarget.set(target, []);
      byTarget.get(target).push(item.uid);
    }
    const out = [];
    for (const row of list) {
      const key = Array.isArray(row) ? String(row[0] ?? "") : String(row?.cardUid ?? "");
      const owners = byTarget.get(key) || [];
      if (!owners.length) { out.push(row); continue; }
      for (const itemUid of owners) {
        if (Array.isArray(row)) out.push([itemUid, row[1], row[2], row[3], row[4]]);
        else out.push({ ...row, cardUid: itemUid });
      }
    }
    return out;
  };
  const pulseTimeline = (uids) => {
    const wanted = uids instanceof Set ? uids : new Set(uids || []);
    const b = board();
    if (!b) return;
    for (const item of b.items.values()) {
      if (item?.type !== "card") continue;
      const target = timelineTargetUid(item);
      if (wanted.has(item.uid) || (target && wanted.has(target))) pulseItem(item.uid);
    }
  };
  const edgeList = () => root.querySelectorAll?.(".pxd-edge") || [];
  const dustShells = () => [...(root.querySelectorAll?.(".pxd-item[data-uid]") || [])];
  const paintLenses = () => {
    if (disposed) return;
    if (strengthOn && strengthScores) {
      try { applyStrength(edgeList(), strengthScores); } catch { /* paint */ }
      if (!strengthStale) {
        for (const uid of board()?.edges?.keys?.() || []) {
          if (strengthScores.has(uid)) continue;
          strengthStale = true;
          setTimeout(() => { strengthStale = false; if (!disposed) void refreshStrength(); }, 300);
          break;
        }
      }
    }
    if (dustPeriod && dustPeriod !== "off" && dustAges) {
      try { applyDust(dustShells(), dustAges, dustPeriod); } catch { /* paint */ }
    }
  };
  const boardsFor = (uid) => {
    if (!uid) return [];
    try {
      if (typeof boardsOf === "function") {
        const list = boardsOf(uid);
        if (Array.isArray(list)) return list.map((row) => (row && typeof row === "object" ? row.uid : row)).filter(Boolean);
      }
    } catch { /* cache */ }
    try {
      const list = win?.PlexusDiagram?.boardsWith?.(uid);
      return Array.isArray(list) ? list.map((row) => row?.uid).filter(Boolean) : [];
    } catch { return []; }
  };
  const shareCount = (a, b) => {
    const left = new Set(boardsFor(a));
    let n = 0;
    for (const id of boardsFor(b)) if (id !== boardUid && left.has(id)) n += 1;
    return n;
  };
  const endTarget = (itemUid) => timelineTargetUid(board()?.items.get(itemUid)) || itemUid || "";
  const ensureOpenStore = () => {
    if (!trackOpensOn()) return openStore;
    if (!openStore) openStore = createOpenStore({ storage, graph, enabled: true });
    else openStore.setEnabled(true);
    return openStore;
  };
  const askRows = (query, ids) => {
    if (!ids.length || typeof host?.q !== "function") return Promise.resolve([]);
    try {
      return Promise.resolve(host.q(query, ids)).then((rows) => (Array.isArray(rows) ? rows : [])).catch(() => []);
    } catch { return Promise.resolve([]); }
  };
  const refreshStrength = async () => {
    const gen = ++strengthGen;
    if (!strengthOn) {
      strengthScores = null;
      try { clearLens(edgeList(), []); } catch { /* paint */ }
      if (dustPeriod !== "off" && dustAges) {
        try { applyDust(dustShells(), dustAges, dustPeriod); } catch { /* paint */ }
      }
      return;
    }
    ensureOpenStore();
    const edges = [...(board()?.edges?.values?.() || [])];
    const ids = [];
    const seen = new Set();
    const ends = [];
    const add = (id) => {
      const s = String(id || "").trim();
      if (!s || seen.has(s)) return;
      seen.add(s);
      ids.push(s);
    };
    for (const edge of edges) {
      const from = endTarget(edge.from);
      const to = endTarget(edge.to);
      ends.push({ uid: edge.uid, from, to });
      add(from);
      add(to);
    }
    if (!ids.length) {
      if (gen !== strengthGen || !strengthOn || disposed) return;
      strengthScores = new Map();
      paintLenses();
      return;
    }
    const [refRows, editRows] = await Promise.all([
      askRows("[:find ?u ?ru :in $ [?u ...] :where [?e :block/uid ?u] [?r :block/refs ?e] [?r :block/uid ?ru]]", ids),
      askRows("[:find ?u ?t :in $ [?u ...] :where [?e :block/uid ?u] [?e :edit/time ?t]]", ids),
    ]);
    if (disposed || gen !== strengthGen || !strengthOn) return;
    const refCount = new Map();
    const edgeUids = new Set(edges.map((e) => e.uid));
    for (const row of refRows) {
      if (!Array.isArray(row) || row.length < 2 || edgeUids.has(String(row[1]))) continue;
      const key = String(row[0]);
      refCount.set(key, (refCount.get(key) || 0) + 1);
    }
    const editAt = new Map();
    for (const row of editRows) {
      if (Array.isArray(row) && row.length >= 2 && Number.isFinite(Number(row[1]))) editAt.set(String(row[0]), Number(row[1]));
    }
    const now = Date.now();
    const track = Boolean(openStore && openStore.enabled);
    const scores = new Map();
    for (const edge of ends) {
      const times = [editAt.get(edge.from), editAt.get(edge.to)].filter((n) => Number.isFinite(n));
      const components = {
        refs: (refCount.get(edge.from) || 0) + (refCount.get(edge.to) || 0),
        shared: shareCount(edge.from, edge.to),
        now,
      };
      if (times.length) components.editTime = Math.max(...times);
      if (track) components.opens = edgeOpens(openStore, edge.from, edge.to);
      scores.set(edge.uid, { components, trackOpens: track, now });
    }
    strengthScores = scores;
    try { applyStrength(edgeList(), strengthScores); } catch { /* paint */ }
  };
  const refreshDust = async () => {
    const gen = ++dustGen;
    if (!dustPeriod || dustPeriod === "off") {
      dustAges = null;
      try { clearLens([], dustShells()); } catch { /* paint */ }
      if (strengthOn && strengthScores) {
        try { applyStrength(edgeList(), strengthScores); } catch { /* paint */ }
      }
      return;
    }
    const cards = [...(board()?.items?.values?.() || [])].filter((it) => it?.type === "card");
    const ids = [];
    const seen = new Set();
    const pairs = [];
    for (const card of cards) {
      const target = timelineTargetUid(card) || card.uid;
      pairs.push({ uid: card.uid, target });
      if (target && !seen.has(target)) { seen.add(target); ids.push(target); }
    }
    if (!ids.length) {
      if (gen !== dustGen || dustPeriod === "off" || disposed) return;
      dustAges = new Map();
      paintLenses();
      return;
    }
    const rows = await askRows("[:find ?u ?e ?c :in $ [?u ...] :where [?b :block/uid ?u] [(get-else $ ?b :edit/time -1) ?e] [(get-else $ ?b :create/time -1) ?c]]", ids);
    if (disposed || gen !== dustGen || dustPeriod === "off") return;
    const by = new Map();
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      const edit = Number(row[1]);
      const create = Number(row[2]);
      by.set(String(row[0]), {
        edit: Number.isFinite(edit) && edit >= 0 ? edit : null,
        create: Number.isFinite(create) && create >= 0 ? create : null,
      });
    }
    const now = Date.now();
    const ages = new Map();
    for (const pair of pairs) {
      const hit = by.get(pair.target) || {};
      const age = { now };
      if (hit.edit != null) age.editTime = hit.edit;
      if (hit.create != null) age.createTime = hit.create;
      ages.set(pair.uid, age);
    }
    dustAges = ages;
    try { applyDust(dustShells(), dustAges, dustPeriod); } catch { /* paint */ }
  };

  // BA-3: block ends follow their row. Row offsets are measured only for edges that have block ends, in one
  // batched frame, whenever the page body scrolls or re-renders, or the card moves, resizes or folds.
  const blockCards = new Set();
  let blockSig = "";
  let anchorFrame = false;
  const refreshBlockCards = () => {
    blockCards.clear();
    const b = board();
    if (!b) return false;
    for (const e of b.edges.values()) {
      if (e.fromBlock) blockCards.add(e.from);
      if (e.toBlock) blockCards.add(e.to);
    }
    const sig = [...blockCards].sort().join(",");
    if (sig !== blockSig) { blockSig = sig; itemsR.setLayoutWatch?.(blockCards); }
    return blockCards.size > 0;
  };
  const runAnchors = () => {
    anchorFrame = false;
    const b = board();
    if (disposed || suspended || !b) return;
    refreshBlockCards();
    const next = new Map();
    for (const e of b.edges.values()) {
      if (!e.fromBlock && !e.toBlock) continue;
      const m = {};
      if (e.fromBlock) { const x = itemsR.measureRow(e.from, e.fromBlock); if (x) m.from = x; }
      if (e.toBlock) { const x = itemsR.measureRow(e.to, e.toBlock); if (x) m.to = x; }
      if (m.from || m.to) next.set(e.uid, m);
    }
    const changed = edgesR.setMeasures(next);
    if (changed.size) edgesR.update({ board: b, edgeUids: changed, rects: paintRects(), zoom: vp.zoom });
    markLinkedRows(b, next);
  };
  // RF-2: every row a block arrow ends on shows in the edge's color, with a tooltip naming the other end.
  const rowEdges = new Map(); // `${card}|${row}` → [edge uids], kept for hover in both directions
  let rowMarkKey = "";
  const edgeTone = (e) => (PALETTE.includes(e.color) ? `var(--pxd-${e.color}-line)` : hexColor(e.color) || "var(--pxd-edge)");
  const cardName = (b, uid) => {
    const it = b.items.get(uid);
    const t = String(it?.title ?? "").trim();
    return t || (it?.kind === "page" ? "page" : "card");
  };
  const markLinkedRows = (b, measured) => {
    rowEdges.clear();
    const groups = new Map();
    for (const e of b.edges.values()) {
      const m = measured.get(e.uid);
      if (!m) continue;
      for (const end of ["from", "to"]) {
        const row = end === "from" ? e.fromBlock : e.toBlock;
        if (!row || !m[end]?.rendered) continue;
        const card = end === "from" ? e.from : e.to;
        const other = cardName(b, end === "from" ? e.to : e.from);
        const key = `${card}|${row}`;
        const g = groups.get(key) || { card, row, edges: [], color: edgeTone(e), tips: [] };
        g.edges.push(e.uid);
        g.tips.push(`${end === "to" ? "Linked from" : "Links to"} ${other}${e.label ? ` \u00b7 ${e.label}` : ""}`);
        groups.set(key, g);
      }
    }
    for (const [key, g] of groups) rowEdges.set(key, g.edges);
    const marks = [...groups.values()].map((g) => ({ card: g.card, row: g.row, edges: g.edges, color: g.color, tip: g.tips.join(" | ") }));
    // runAnchors repeats on scroll. Skip the row attribute rewrite when the edge list, color and tip match.
    const markKey = JSON.stringify(marks.map((g) => [g.card, g.row, g.edges.join(" "), g.color, g.tip]).sort((a, b) => String(a[0] + a[1]).localeCompare(String(b[0] + b[1]))));
    if (markKey === rowMarkKey) return;
    rowMarkKey = markKey;
    itemsR.markRows(marks);
  };
  // The arrow lights its rows and the row lights its arrows. Each side sets only its own class, so no loop.
  const hoverRows = (edgeUid, on) => {
    const e = board()?.edges.get(edgeUid);
    if (!e) return;
    if (e.fromBlock) itemsR.setRowHot(e.from, e.fromBlock, on);
    if (e.toBlock) itemsR.setRowHot(e.to, e.toBlock, on);
  };
  listen(root, "pointerover", (event) => {
    if (event.buttons) return;
    const row = event.target?.closest?.(".pxd-row--linked, [data-pxd-edges]");
    if (!row) return;
    for (const uid of String(row.getAttribute("data-pxd-edges") || "").split(" ").filter(Boolean)) { edgesR.setHover(uid, true); hoverRows(uid, true); }
  });
  listen(root, "pointerout", (event) => {
    const row = event.target?.closest?.(".pxd-row--linked, [data-pxd-edges]");
    if (!row || row.contains?.(event.relatedTarget)) return;
    for (const uid of String(row.getAttribute("data-pxd-edges") || "").split(" ").filter(Boolean)) { edgesR.setHover(uid, false); hoverRows(uid, false); }
  });
  function scheduleAnchors() {
    if (disposed || anchorFrame) return;
    anchorFrame = true;
    timers.frame(runAnchors);
  }

  const schedule = () => {
    if (disposed || suspended || frameHandle) return;
    frameHandle = timers.frame(() => { frameHandle = null; renderFrame(); });
  };
  // RF-4: the hover toolbar waits HOVER_GRACE ms before it hides or switches to another card, so the pointer can
  // travel from the card to the bar. Declared here because setViewport (pan/zoom) hides it at once.
  const HOVER_GRACE = 400;
  let hoverUid = null;
  let hoverPending = null; // { cancel }
  function cancelHoverGrace() {
    if (hoverPending) { hoverPending.cancel?.(); hoverPending = null; }
  }
  function hideHover() {
    cancelHoverGrace();
    if (hoverUid) { hoverUid = null; chrome.ctx.hide(); }
  }
  const markViewport = () => { dirty.viewport = true; schedule(); };
  const markAll = () => { dirty.all = true; dirty.structural = true; schedule(); };

  // ------------------------------------------------------------ viewport
  const setViewport = (next) => {
    if (!next) return;
    vp = { x: next.x, y: next.y, zoom: next.zoom };
    if (hoverUid) hideHover();
    markViewport();
    // Buttons, Fit, search and edit-zoom change the viewport outside a gesture: re-evaluate LOD + content.
    if (!gesturing) settle();
  };
  // Button zoom, Fit, and present steps ease the world transform. Pan and wheel do not:
  // a transition on every pointer frame would lag the camera.
  let zoomOff = null;
  const clearZoomAnim = () => {
    if (zoomOff) { zoomOff(); zoomOff = null; }
    root.classList.remove("pxd-root--zooming");
  };
  const armZoomAnim = () => {
    const ms = motionProfile(currentMotion()).zoomMs;
    clearZoomAnim();
    if (ms <= 0) return;
    root.classList.add("pxd-root--zooming");
    zoomOff = timers.later(() => {
      zoomOff = null;
      if (!disposed) root.classList.remove("pxd-root--zooming");
    }, ms);
  };
  const animateViewport = (next) => { armZoomAnim(); setViewport(next); };
  const moveViewport = (next) => { clearZoomAnim(); setViewport(next); };
  // Screen strips a fit must keep content out of: the toolbar, an open side panel, and the title pill that floats
  // above a section sitting on the top edge of the fitted bounds.
  const fitInsets = (bounds) => {
    const rr = root.getBoundingClientRect?.() || rootRect;
    const tb = chrome.toolbar.el?.getBoundingClientRect?.();
    const pel = panel.el?.style?.display !== "none" ? panel.el?.getBoundingClientRect?.() : null;
    const b = board();
    const r = b ? rects() : null;
    const titled = Boolean(bounds && b && [...b.items.values()].some((it) => it.type === "section" && r.get(it.uid) && r.get(it.uid).y <= bounds.y + 0.5));
    return {
      top: (tb?.height ? Math.max(0, tb.bottom - (rr.top || 0)) : 0) + (titled ? SECTION_TITLE_ALLOWANCE : 0),
      right: pel?.width ? Math.max(0, Math.min(size.width, (rr.left || 0) + size.width - pel.left)) : 0,
    };
  };
  const fitTo = (bounds, opts = {}) => {
    if (!size.width || !size.height) measure();
    animateViewport(fitViewport(bounds, size, { padding: 64, maxZoom: opts.maxZoom ?? 1.5, insets: fitInsets(bounds) }));
  };
  const fitAll = () => fitTo(boundsOf([...rects().values()]));
  const fitSelection = (uids) => {
    const r = rects();
    const b = boundsOf(uids.map((u) => r.get(u)).filter(Boolean));
    if (b) fitTo(b, { maxZoom: 1 });
  };
  const centerOn = (worldPoint) => {
    moveViewport({ x: size.width / 2 - worldPoint.x * vp.zoom, y: size.height / 2 - worldPoint.y * vp.zoom, zoom: vp.zoom });
  };

  // ------------------------------------------------------------ LOD
  const mapThreshold = () => zoomThreshold(board()?.plexus?.lodZoom, setting("map-zoom", "0.45"));
  // Classes and font variables are written only when the tier changes (renderFrame) or a viewport settles.
  const paintTier = () => {
    root.classList.toggle("pxd-lod-map", tier !== "detail");
    root.classList.toggle("pxd-lod-overview", tier === "overview");
    const f = lodFonts(vp.zoom);
    root.style.setProperty("--pxd-map-font", `${f.map}px`);
    root.style.setProperty("--pxd-ui", String(f.ui));
    root.style.setProperty("--pxd-overview-font", `${f.section}px`);
    itemsR.setLod(tier, vp.zoom);
  };
  // PO-5: one write per zoom change (a pan never touches it); the grips size themselves from it with calc().
  let invZoomAt = 0;
  const paintInvZoom = () => {
    if (vp.zoom === invZoomAt) return;
    invZoomAt = vp.zoom;
    root.style.setProperty("--pxd-inv-zoom", String(invZoom(vp.zoom)));
    root.style.setProperty("--pxd-screen-px", String(screenPx(vp.zoom)));
  };
  const applyLod = () => {
    tier = lodTier(vp.zoom, tier, { threshold: mapThreshold() });
    paintTier();
    paintInvZoom();
  };
  const scheduleContent = () => {
    if (disposed || suspended || gesturing || !board()) return;
    // A null previous board marks every item dirty. Later diffs pass only the dirty uids.
    const changed = dirty.all ? null : dirty.items;
    itemsR.scheduleContent({ visibleRect: visibleWorldRect(vp, size, CULL_MARGIN), zoom: vp.zoom, tier, dirty: changed });
  };
  // "Back to content": shown when no item intersects the visible world rect.
  const updateBackToContent = () => {
    if (disposed || suspended) return;
    let show = false;
    if (size.width && size.height) {
      const r = rects();
      if (r.size) {
        const view = visibleWorldRect(vp, size, 0);
        show = true;
        for (const rect of r.values()) if (rectsIntersect(rect, view)) { show = false; break; }
      }
    }
    if (show === backVisible) return;
    backVisible = show;
    chrome.backToContent.setVisible(show);
  };

  // ------------------------------------------------------------ card badges (read-only)
  const badgeKeyOf = (item) => (item.target.kind === "page" ? `page:${item.target.title}` : `uid:${item.target.uid || item.uid}`);
  const badgeTargetOf = (item) => (item.target.kind === "page" ? { kind: "page", title: item.target.title } : { kind: "block", uid: item.target.uid || item.uid });
  const visibleBadgeItems = () => {
    const b = board();
    if (!b) return [];
    const view = visibleWorldRect(vp, size, 0);
    const r = rects();
    const out = [];
    for (const item of b.items.values()) {
      if (out.length >= BADGE_MAX) break;
      if (item.type !== "card" || item.kind === "board" || item.kind === "image") continue;
      const rect = r.get(item.uid);
      if (rect && rectsIntersect(rect, view)) out.push(item);
    }
    return out;
  };
  const applyBadges = () => {
    if (disposed) return;
    const map = new Map();
    for (const item of visibleBadgeItems()) {
      const hit = badgeCache.get(badgeKeyOf(item));
      if (hit) map.set(item.uid, hit.stats);
    }
    itemsR.setBadges(map);
  };
  const refreshBadges = () => {
    if (disposed || gesturing || !board()) return;
    itemsR.setShowBadges(flag("show-card-badges", true));
    if (!flag("show-card-badges", true) || tier !== "detail" || typeof host?.cardStats !== "function") return;
    const items = visibleBadgeItems();
    const now = Date.now();
    const misses = [];
    const seen = new Set();
    for (const item of items) {
      const key = badgeKeyOf(item);
      const hit = badgeCache.get(key);
      if ((hit && now - hit.at < BADGE_TTL_MS) || seen.has(key) || badgePending.has(key)) continue;
      seen.add(key);
      misses.push({ key, target: badgeTargetOf(item) });
    }
    if (!misses.length) { applyBadges(); return; }
    // The stats queries scan the graph on the main thread: run them in idle slots, a few cards at a time.
    for (const m of misses) badgePending.add(m.key);
    const runChunk = (list) => {
      if (disposed) return;
      const chunk = list.slice(0, BADGE_CHUNK);
      const rest = list.slice(BADGE_CHUNK);
      let res;
      try { res = host.cardStats(chunk.map((m) => m.target), { boardUid }); } catch { res = undefined; }
      const at = Date.now();
      for (const m of chunk) {
        badgePending.delete(m.key);
        if (res === undefined) continue;
        const stats = res instanceof Map ? res.get(m.key) : res?.[m.key];
        badgeCache.set(m.key, { at, stats: stats || { refs: 0, boards: 0, open: 0, done: 0 } });
      }
      applyBadges();
      if (rest.length) timers.idle(() => runChunk(rest));
    };
    timers.idle(() => runChunk(misses));
  };
  const scheduleBadges = (ms = 0) => {
    if (disposed || suspended) return;
    badgeTimer?.();
    badgeTimer = timers.later(() => { badgeTimer = null; refreshBadges(); }, ms);
  };

  const settle = () => {
    settleTimer?.();
    settleTimer = timers.later(() => {
      settleTimer = null;
      if (gesturing) return;
      applyLod();
      scheduleContent();
      vpStore.set(vpId, vp);
      dirty.edges = new Set(board()?.edges.keys() || []); // arrow sizes depend on zoom
      dirty.links = true;
      dirty.minimap = true;
      schedule();
      updateBackToContent();
      refreshBadges();
      refreshThumbnails();
      pdfFlip?.settle?.();
      scheduleSharpCovers();
      // Fit and other camera moves are not pointer gestures, so the gesture-end
      // warm pass never runs. Look again once the viewport has settled.
      considerCoverWarm();
    }, RESUME_MS);
  };
  const refreshThumbnails = () => {
    if (disposed || gesturing || !board()) return;
    const view = visibleWorldRect(vp, size, 0);
    const r = rects();
    const candidates = [];
    for (const card of board().items.values()) {
      if (card.type !== "card" || card.kind !== "block") continue;
      const rect = r.get(card.uid);
      if (!rect || !rectsIntersect(rect, view)) continue;
      let refString = "";
      try { refString = host?.blockString?.(card.target?.uid) || ""; } catch { refString = ""; }
      if (classifyString(refString).kind !== "board") continue;
      candidates.push(card.uid);
    }
    const batch = thumbnailBudget(candidates);
    if (batch.length) itemsR.expireContent?.(batch);
  };
  const paintTimer = () => {
    if (!timerHud || !timerState) return;
    const secs = Math.ceil(timerState.remainingMs / 1000);
    const m = Math.floor(secs / 60);
    timerHud.textContent = `${m}:${String(secs % 60).padStart(2, "0")}`;
  };
  const stopTimer = () => {
    timerTick?.();
    timerTick = null;
    timerHud?.remove();
    timerHud = null;
    timerState = null;
  };
  const armTimer = () => {
    timerTick?.();
    timerTick = timers.later(() => {
      timerTick = null;
      if (!timerState?.running || disposed) return;
      timerState = timerStep(timerState, Date.now());
      paintTimer();
      if (timerState.running) armTimer();
      else toast("Focus timer done");
    }, 1000);
  };

  // ------------------------------------------------------------ selection + context bar
  const selectedItems = () => selection.items.map((u) => board()?.items.get(u)).filter(Boolean);
  const toScreenRect = (r) => {
    const p = worldToScreen(vp, { x: r.x, y: r.y });
    return { x: p.x, y: p.y, w: r.w * vp.zoom, h: r.h * vp.zoom };
  };
  const pathScreenRect = (geo, extra) => {
    const pts = [geo.start, geo.end, geo.mid].filter(Boolean).map((p) => worldToScreen(vp, p));
    for (const r of extra) pts.push({ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y + r.h });
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  };
  const ctxAnchor = () => {
    const b = board();
    if (!b) return null;
    if (selection.edge) {
      const edge = b.edges.get(selection.edge);
      const geo = edgesR.geometryOf(selection.edge);
      if (!edge || !geo) return null;
      // Anchor on the whole connection (path + label) so the bar clears the line, not just its midpoint.
      const lr = edge.label ? edgesR.labelRect(selection.edge) : null;
      const extra = lr && lr.width ? [{ x: lr.left - rootRect.left, y: lr.top - rootRect.top, w: lr.width, h: lr.height }] : [];
      return { kind: "edge", rect: pathScreenRect(geo, extra) };
    }
    if (selection.link) {
      const geo = edgesR.linkGeometryOf(selection.link);
      if (!geo) return null;
      return { kind: "edge", rect: pathScreenRect(geo, []) };
    }
    const r = paintRects();
    const bounds = boundsOf(selection.items.map((u) => r.get(u)).filter(Boolean));
    return bounds ? { kind: "items", rect: toScreenRect(bounds) } : null;
  };
  const refCountOf = (item) => {
    if (!item || item.type !== "card") return 0;
    const key = badgeKeyOf(item);
    const hit = badgeCache.get(key);
    if (hit) return Number(hit.stats?.refs) || 0;
    if (typeof host?.cardStats !== "function") return 0;
    let res;
    try { res = host.cardStats([badgeTargetOf(item)], { boardUid }); } catch { return 0; }
    const stats = (res instanceof Map ? res.get(key) : res?.[key]) || { refs: 0, boards: 0, open: 0, done: 0 };
    badgeCache.set(key, { at: Date.now(), stats });
    return Number(stats.refs) || 0;
  };
  const cardModel = (item) => (item?.type === "card" ? { ...item, refs: refCountOf(item) } : item);
  const sectionModel = (item) => {
    const b = board();
    const uids = b ? [item.uid, ...descendantsOf(b, item.uid)] : [item.uid];
    return {
      ...item,
      hasNote: Boolean(b && sectionNoteUid(b, item.uid)),
      locked: Boolean(b) && uids.every((u) => b.items.get(u)?.pinned),
    };
  };
  const showCtx = () => {
    const b = board();
    if (!b) return chrome.ctx.hide();
    if (selection.edge) {
      const edge = b.edges.get(selection.edge);
      return edge ? chrome.ctx.show("edge", edge, ctxAnchor) : chrome.ctx.hide();
    }
    if (selection.link) {
      const link = (session.links || []).find((l) => l.key === selection.link);
      return link ? chrome.ctx.show("link", link, ctxAnchor) : chrome.ctx.hide();
    }
    const items = selectedItems();
    if (!items.length) return chrome.ctx.hide();
    if (items.length > 1) {
      const model = { count: items.length, allPinned: items.every((i) => i.pinned), anyCollapsed: items.some((i) => i.type === "card" && i.collapsed) };
      return chrome.ctx.show("cards", model, ctxAnchor);
    }
    const it = items[0];
    const kind = it.type === "section" ? "section" : it.type === "text" ? "text" : it.kind === "board" ? "board" : "card";
    const model = it.type === "section" ? sectionModel(it) : cardModel(it);
    return chrome.ctx.show(kind, model, ctxAnchor);
  };

  // ------------------------------------------------------------ session mutations used by chrome
  const targetUids = () => (selection.edge ? [selection.edge] : selection.items);
  const singleItem = () => (selection.items.length === 1 ? board()?.items.get(selection.items[0]) : null);
  const selectionOwnsBar = () => Boolean(selection.edge || selection.link || selection.items.length);
  const barCard = () => {
    const sel = singleItem();
    if (sel?.type === "card") return sel;
    if (!selectionOwnsBar() && hoverUid) {
      const it = board()?.items.get(hoverUid);
      if (it?.type === "card") return it;
    }
    return null;
  };
  const mentionsUid = (item) => {
    if (!item) return null;
    if (item.target?.kind === "page") return host?.pageUid?.(item.target.title) || null;
    if (item.target?.kind === "block") return item.target.uid || null;
    return item.uid;
  };
  const openBoardOutline = () => {
    const uid = board()?.uid;
    if (uid) host?.openInSidebar?.(uid, "outline");
  };
  const openItemInSidebar = (item) => {
    if (!item) return;
    if (item.target.kind === "page") {
      const uid = host?.pageUid?.(item.target.title);
      if (uid) { bumpOpen(uid); host?.openInSidebar?.(uid, "outline"); }
    } else {
      const uid = item.target.uid || item.uid;
      bumpOpen(uid);
      host?.openInSidebar?.(uid, "block");
    }
  };
  const stackAt = (strings, x, y, h) => strings.map((string, i) => ({ string, x, y: y + i * (h + 24) }));
  const addStringsBeside = (strings) => {
    const b = board();
    if (!b || !strings.length) return;
    const r = rects();
    const sel = singleItem();
    const w = Number(setting("default-card-width", DEFAULT_SIZES.card.w)) || DEFAULT_SIZES.card.w;
    const h = Number(setting("default-card-height", DEFAULT_SIZES.card.h)) || DEFAULT_SIZES.card.h;
    let x; let y;
    if (sel && r.get(sel.uid)) { const sr = r.get(sel.uid); x = sr.x + sr.w + 40; y = sr.y; }
    else { const c = screenToWorld(vp, { x: size.width / 2, y: size.height / 2 }); x = c.x - w / 2; y = c.y - h / 2; }
    void session.addRefCards?.(stackAt(strings, x, y, h));
  };
  const isOnBoard = (string) => {
    const b = board();
    if (!b) return false;
    const s = String(string || "").trim();
    for (const item of b.items.values()) {
      if (item.string.trim() === s || semanticRef(item) === s) return true;
    }
    return false;
  };

  // ------------------------------------------------------------ nested boards
  // `crumbs` entries are shared with the feature's record, so a rename shows up in both.
  const crumbList = Array.isArray(crumbs) ? crumbs : [];
  // The board block a card opens: the card itself (nested board), or the target of a whiteboard-shortcut
  // card (a ((ref)) to a {{[[diagram]]}} block). `uid` is an item uid, or a referenced uid the card renderer passes.
  const boardTargetOf = (uid) => {
    const item = board()?.items.get(uid);
    if (item?.kind === "board") return uid;
    const ref = item ? (item.kind === "block" ? item.target?.uid : null) : uid;
    if (!ref || typeof host?.blockString !== "function") return null;
    return classifyString(host.blockString(ref)).kind === "board" ? ref : null;
  };
  const openBoard = async (uid) => {
    const target = boardTargetOf(uid);
    if (!target) return;
    if (itemsR.isEditing()) await exitEdit();
    if (disposed) return;
    if (onOpenBoard) onOpenBoard(target);
    else host?.openBlock?.(target);
  };
  const openOwnPage = (item) => {
    const target = item ? boardTargetOf(item.uid) : null;
    if (target) host?.openBlock?.(target);
  };
  const goCrumb = async (index) => {
    if (itemsR.isEditing()) await exitEdit();
    if (disposed) return;
    onCrumb?.(index);
  };
  const popBoard = () => {
    if (crumbList.length > 1 && onCrumb) { void goCrumb(crumbList.length - 2); return true; }
    return false;
  };

  // ------------------------------------------------------------ 1.2 helpers
  const toast = (message, undo = false) => chrome.toast.show({ message, action: undo ? { label: "Undo", run: () => session.undo?.() } : undefined });
  const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const closeLinksMenu = () => {
    const menu = linksMenu;
    linksMenu = null;
    if (!menu) return;
    try { menu.remove(); } catch { /* a body menu must still leave */ }
    if (menu.parentElement) {
      try { menu.parentElement.removeChild(menu); } catch { /* already gone */ }
    }
  };
  const refreshSuggest = () => {
    suggestSelKey = selection.items.join("|");
    const b = board();
    if (!b || suggestMode === "off") { edgesR.setSuggest?.([]); return; }
    const cards = [];
    for (const item of b.items.values()) {
      if (item.type === "section") continue;
      const text = `${item.string || ""} ${item.title || ""}`;
      const refs = [];
      const re = /\[\[([^\]\n]+)\]\]/g;
      let match;
      while ((match = re.exec(text))) refs.push(match[1]);
      cards.push({
        uid: item.uid,
        text,
        refs,
        attrs: [],
        pageTitle: item.kind === "page" ? (item.target?.title || item.title || "") : "",
      });
    }
    const existing = new Set([...b.edges.values()].map((edge) => pairKey(edge.from, edge.to)));
    const picked = selection.items.length > 1 ? new Set(selection.items) : null;
    const result = suggestPairs(cards, { mode: suggestMode, existing, dismissed: suggestDismissed, only: picked });
    if (result.tooMany) {
      edgesR.setSuggest?.([]);
      if (!suggestWarned) { suggestWarned = true; toast("Too many cards to suggest"); }
      return;
    }
    suggestWarned = false;
    const placed = paintRects();
    const lines = [];
    for (const pair of result.pairs) {
      const a = placed.get(pair.a);
      const c = placed.get(pair.b);
      if (!a || !c) continue;
      const pa = center(a);
      const pb = center(c);
      lines.push({ x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y, reason: pair.reason, a: pair.a, b: pair.b, key: pair.key });
    }
    edgesR.setSuggest?.(lines);
  };
  const openSuggestAction = (line) => {
    closeLinksMenu();
    const menu = doc.createElement("div");
    menu.className = "pxd-linksmenu pxd-root";
    menu.style.position = "fixed";
    const box = line?.getBoundingClientRect?.() || { left: 8, bottom: 40 };
    menu.style.left = `${box.left || 8}px`;
    menu.style.top = `${(box.bottom || 40) + 4}px`;
    menu.style.height = "auto";
    const add = (label, run) => {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "pxd-linksmenu__row";
      button.textContent = label;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        run();
        closeLinksMenu();
      });
      menu.append(button);
    };
    const reason = line.getAttribute("data-reason") || "";
    const a = line.getAttribute("data-a");
    const b = line.getAttribute("data-b");
    const key = line.getAttribute("data-key");
    add("Connect", () => {
      const name = /\[\[(.+?)\]\]/.exec(reason)?.[1] || "";
      if (a && b) void session.addEdge?.({ from: a, to: b, label: name });
    });
    add("Link text", () => {
      const title = /'([^']+)'/.exec(reason)?.[1] || "";
      const item = board()?.items.get(a);
      const next = item && title ? linkMention(item.string || item.title || "", title) : null;
      if (next) void session.setString?.(item.uid, next);
    });
    add("Dismiss", () => { if (key) suggestDismissed.add(key); refreshSuggest(); });
    (doc.body || root).append(menu);
    linksMenu = menu;
  };
  const openWhy = (uid, focus = "label") => {
    const edge = board()?.edges.get(uid);
    if (!edge) return;
    whyPop?.close();
    const labelEl = edgesR.labelEl?.(uid);
    let box = labelEl?.getBoundingClientRect?.();
    if (!box || !(box.width || box.height)) {
      // An empty label is display:none and measures zero: anchor on the edge midpoint instead.
      const mid = edgesR.geometryOf?.(uid)?.mid;
      const p = mid ? worldToScreen(vp, mid) : { x: 24, y: 24 };
      const left = rootRect.left + p.x;
      const top = rootRect.top + p.y;
      box = { left, top, right: left + 56, bottom: top + 24 };
    }
    whyPop = openWhyPopover({
      doc,
      anchor: box,
      label: edge.label || "",
      why: edge.why || "",
      focus,
      onSave: (next) => { whyPop = null; void session.commitWhy?.(uid, next); },
      onCancel: () => { whyPop = null; },
    });
  };
  const openContexts = (uid) => {
    contextsDrawer?.close();
    let raw = [];
    try {
      raw = host?.q?.(CONTEXTS_QUERY, uid) || [];
    } catch { raw = []; }
    const rows = raw.map((row) => ({ uid: row[0], time: Number(row[3]), crumb: breadcrumb(row[2], row[4]), snippet: snippetOf(row[1]) }));
    contextsDrawer = mountContextsDrawer({
      doc,
      parent: root,
      rows,
      onOpen: (blockUid, { sidebar }) => {
        if (sidebar) host?.openInSidebar?.(blockUid, "block");
        else host?.openBlock?.(blockUid);
      },
    });
  };
  const lanePaintRects = () => {
    const base = paintRects();
    if (!lanePreviewLayout) return base;
    const merged = new Map(base);
    for (const [uid, rect] of lanePreviewLayout) {
      const own = base.get(uid);
      merged.set(uid, { x: rect.x, y: rect.y, w: Number.isFinite(rect.w) ? rect.w : own?.w, h: Number.isFinite(rect.h) ? rect.h : own?.h });
    }
    return merged;
  };
  const updateLaneEdges = (b) => edgesR.update({ board: b, edgeUids: [...b.edges.keys()], rects: lanePaintRects(), zoom: vp.zoom });
  const applyLaneMarks = () => {
    const b = board();
    if (!b) return;
    for (const item of b.items.values()) {
      const el = itemsR.shellOf(item.uid);
      if (!el) continue;
      el.classList.toggle("pxd-item--future", Boolean(laneMarks?.future.has(item.uid)));
      el.classList.toggle("pxd-item--fresh", Boolean(laneMarks?.fresh.has(item.uid)));
      const moved = lanePreviewLayout?.get(item.uid);
      if (moved) el.style.transform = `translate(${moved.x}px, ${moved.y}px)`;
    }
  };
  const clearLaneMarks = () => {
    const b = board();
    laneMarks = null;
    lanePreviewLayout = null;
    for (const item of b?.items.values() || []) {
      const el = itemsR.shellOf(item.uid);
      el?.classList.remove("pxd-item--future", "pxd-item--fresh");
      if (lanePreview && el) {
        const rect = rects().get(item.uid);
        if (rect) el.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
      }
    }
    lanePreview = false;
    edgesR.setLaneHidden?.([]);
    if (b) edgesR.update({ board: b, edgeUids: [...b.edges.keys()], rects: paintRects(), zoom: vp.zoom });
  };
  const toggleMemoryLane = () => {
    if (memoryLane) { memoryLane.close(); memoryLane = null; clearLaneMarks(); return; }
    const b = board();
    if (!b) return;
    const uids = [...b.items.keys(), ...b.edges.keys()];
    let times = [];
    try {
      times = uids.length && host?.q ? host.q("[:find ?u ?t :in $ [?u ...] :where [?e :block/uid ?u] [?e :create/time ?t]]", uids) || [] : [];
    } catch { times = []; }
    const timeOf = new Map(times.map((row) => [row[0], row[1]]));
    memoryLane = mountMemoryLane({
      doc,
      parent: root,
      items: uids.map((uid) => ({ uid, time: timeOf.get(uid) })),
      edges: [...b.edges.values()].map((edge) => ({ uid: edge.uid, from: edge.from, to: edge.to, time: timeOf.get(edge.uid) })),
      snapshots: b.snapshots || [],
      motion: setting("motion", "full"),
      onFrame(frame) {
        const live = board();
        if (!live) return;
        laneMarks = { future: new Set(frame.future), fresh: new Set(frame.fresh) };
        applyLaneMarks();
        edgesR.setLaneHidden?.(frame.hiddenEdges);
        updateLaneEdges(live);
      },
      onPreview(preview) {
        const live = board();
        lanePreview = true;
        lanePreviewLayout = preview.layout;
        applyLaneMarks();
        if (live) updateLaneEdges(live);
      },
    });
  };
  const openLinksMenu = (anchor) => {
    closeLinksMenu();
    const menu = doc.createElement("div");
    menu.className = "pxd-linksmenu pxd-root";
    menu.style.position = "fixed";
    const box = anchor?.getBoundingClientRect?.() || { left: 8, bottom: 40 };
    menu.style.left = `${box.left || 8}px`;
    menu.style.top = `${(box.bottom || 40) + 4}px`;
    menu.style.height = "auto";
    const add = (label, run) => {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "pxd-linksmenu__row";
      button.textContent = label;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        run();
        closeLinksMenu();
      });
      menu.append(button);
    };
    const setLinks = (mode) => { linkMode = mode; chrome.toolbar.setLinkMode(linkMode); session.setLinkMode?.(linkMode); };
    add("Links off", () => setLinks("off"));
    add("Attribute links", () => setLinks("attributes"));
    add("All links", () => setLinks("all"));
    add("Suggest off", () => { suggestMode = "off"; suggestWarned = false; refreshSuggest(); });
    add("Suggest shared refs", () => { suggestMode = "shared"; refreshSuggest(); });
    add("Suggest shared and unlinked", () => { suggestMode = "both"; refreshSuggest(); });
    (doc.body || root).append(menu);
    linksMenu = menu;
  };
  listen(edgesSvg, "pointerdown", (event) => {
    const line = event.target?.closest?.(".pxd-suggest__line");
    if (!line) return;
    event.preventDefault();
    event.stopPropagation();
    openSuggestAction(line);
  });
  const lastSelected = () => selection.items[selection.items.length - 1] ?? null;
  const viewCenterWorld = () => screenToWorld(vp, { x: size.width / 2, y: size.height / 2 });
  const cardsIn = (uids) => {
    const b = board();
    const out = new Set();
    if (!b) return [];
    for (const uid of uids) {
      const it = b.items.get(uid);
      if (!it) continue;
      if (it.type === "card") out.add(uid);
      else if (it.type === "section") for (const d of descendantsOf(b, uid)) if (b.items.get(d)?.type === "card") out.add(d);
    }
    return [...out];
  };
  const afterCreate = (label) => (res) => {
    if (disposed) return;
    const list = Array.isArray(res) ? res : [];
    if (!list.length) return;
    ctl.select(list);
    const types = new Set(list.map((u) => board()?.items.get(u)?.type ?? "card"));
    const noun = types.size === 1 && (types.has("card") || types.has("section")) ? [...types][0] : "item";
    toast(`${label} ${list.length} ${list.length === 1 ? noun : `${noun}s`}`, true);
  };
  const copyText = (text, message) => { void writeClipboard({ text }).then((ok) => { if (!disposed) toast(ok ? message : "Copy failed"); }); };
  const openItem = (item) => {
    if (!item) return;
    if (item.kind === "board" || boardTargetOf(item.uid)) { void openBoard(item.uid); return; }
    if (item.target.kind === "page") {
      const uid = host?.pageUid?.(item.target.title);
      if (uid) {
        bumpOpen(uid);
        if (host?.api?.ui?.mainWindow?.openPage) host.api.ui.mainWindow.openPage({ page: { uid } });
        else host?.openBlock?.(uid);
      }
      return;
    }
    const openUid = item.target.uid || item.uid;
    bumpOpen(openUid);
    host?.openBlock?.(openUid);
  };

  // ------------------------------------------------------------ background (pattern + tone)
  const applyBackground = () => {
    const b = board();
    const own = b?.plexus;
    chrome.toolbar.setBoardColor?.(own?.bgColor);
    chrome.toolbar.setBoardDock?.(own?.dock);
    const ownPattern = BOARD_PATTERNS.includes(own?.bg) ? own.bg : null;
    const ownHex = hexColor(own?.bgColor) || null;
    const ownTone = ownHex ? null : (BOARD_TONES.includes(own?.bgColor) ? own.bgColor : null);
    const defPattern = setting("grid", "dots");
    const defTone = setting("board-tone", "none");
    const pattern = ownPattern ?? (BOARD_PATTERNS.includes(defPattern) ? defPattern : "dots");
    const tone = ownHex ? null : (ownTone ?? (BOARD_TONES.includes(defTone) ? defTone : null));
    const image = backgroundImage(own?.bgImage);
    const override = ownPattern !== null || ownTone !== null || ownHex !== null || Boolean(image);
    if (pattern === bgPattern && tone === bgTone && ownHex === bgHex && image === bgImage && override === bgOverride) return;
    if (pattern !== bgPattern) {
      grid.className = `pxd-grid pxd-grid--${pattern}`;
      if (bgPattern === "grid") for (const v of ["--pxd-grid-major", "--pxd-grid-major-x", "--pxd-grid-major-y"]) grid.style.removeProperty?.(v);
      bgPattern = pattern;
      dirty.viewport = true;
      schedule();
    }
    if (tone !== bgTone) {
      if (bgTone) root.classList.remove(`pxd-bg-${bgTone}`);
      if (tone) root.classList.add(`pxd-bg-${tone}`);
      bgTone = tone;
    }
    if (ownHex !== bgHex) {
      if (ownHex) {
        root.style.backgroundColor = ownHex;
        root.style.setProperty("--pxd-label-bg", ownHex);
      } else {
        root.style.backgroundColor = "";
        root.style.removeProperty("--pxd-label-bg");
      }
      bgHex = ownHex;
    }
    if (image !== bgImage) {
      grid.style.backgroundImage = image ? `url("${image}")` : "";
      grid.style.backgroundSize = image ? "cover" : "";
      grid.style.backgroundPosition = image ? "center" : "";
      bgImage = image;
    }
    bgOverride = override;
    chrome.toolbar.setBackground({ pattern, tone: ownHex || tone, override });
  };
  // G3. Root classes for the three optional looks. Defaults leave today's canvas, sections, and bar.
  const applyLooks = () => {
    root.classList.toggle("pxd-look--flat", setting("look-canvas", "dots") === "flat-grey");
    root.classList.toggle("pxd-look--pastel", setting("look-sections", "none") === "pastel");
    root.classList.toggle("pxd-look--tint", setting("look-highlights", "bar") === "tint");
    try { themeFollow?.apply?.(); } catch { /* theme */ }
  };
  const applyMotion = () => {
    applyMotionClasses(root, currentMotion());
    applyLooks();
  };

  // ------------------------------------------------------------ focus mode
  const focusSetNow = () => {
    const b = board();
    if (presentSet) return presentSet;
    if (!focusOn || !b || !selection.items.length) return null;
    const sel = new Set(selection.items);
    const set = new Set(sel);
    for (const e of b.edges.values()) {
      if (!e.valid) continue;
      if (sel.has(e.from)) set.add(e.to);
      if (sel.has(e.to)) set.add(e.from);
    }
    for (const l of session.links || []) {
      if (sel.has(l.from)) set.add(l.to);
      if (sel.has(l.to)) set.add(l.from);
    }
    return set;
  };
  const extraTagText = (item) => {
    if (item?.kind === "highlight") return "";
    try {
      if (item?.kind === "page" && item.target?.title) {
        const page = host?.pullPage?.(item.target.title);
        return (page?.[":block/children"] || []).map((kid) => kid?.[":block/string"] || "").filter(Boolean).join("\n");
      }
      if (item?.kind === "block" && item.target?.uid) return host?.blockString?.(item.target.uid) || "";
    } catch { /* a missing page is not a tag */ }
    return "";
  };
  const rebuildLens = () => {
    const cards = [];
    for (const item of board()?.items.values() || []) {
      if (!item || item.type === "section") continue;
      const tags = tagsForCard(item, extraTagText(item));
      if (item.kind === "highlight") {
        const tag = highlightLensTag(item.highlight?.color);
        if (tag && !tags.includes(tag)) tags.push(tag);
      }
      cards.push({ uid: item.uid, tags });
    }
    const catalog = lensCatalog(cards);
    lensIndex = catalog.byUid;
    return catalog;
  };
  const applyFocus = () => {
    if (disposed) return;
    const focus = focusSetNow();
    const set = lensTag ? lensBright(lensIndex, lensTag, focus) : focus;
    const key = `${lensTag || ""}|${set ? [...set].sort().join("|") : ""}`;
    root.classList.toggle("pxd-root--focus", Boolean(set) || focusOn || Boolean(lensTag));
    chrome.toolbar.setFocus(focusOn);
    chrome.toolbar.setLens?.(Boolean(lensTag));
    if (key === focusKey) return;
    focusKey = key;
    itemsR.setFocus(set);
    edgesR.setFocus(set);
  };
  const toggleFocus = () => {
    if (focusOn) { focusOn = false; applyFocus(); return; }
    if (!selection.items.length) { toast("Select a card to focus on it"); return; }
    focusOn = true;
    applyFocus();
  };
  const exitFocus = () => {
    if (!focusOn) return false;
    focusOn = false;
    applyFocus();
    return true;
  };

  // ------------------------------------------------------------ session actions shared by chrome and the menu
  const setFolded = (uids, value) => {
    const cards = cardsIn(uids);
    if (cards.length) void session.setCollapsedMany?.(cards, value);
  };
  const foldSelection = () => {
    const cards = cardsIn(selection.items);
    if (!cards.length) return;
    const b = board();
    void session.setCollapsedMany?.(cards, cards.some((u) => !b.items.get(u).collapsed));
  };
  const alignSel = (mode, uids = selection.items) => {
    const r = rects();
    const b = board();
    const list = uids.filter((uid) => !b?.items.get(uid)?.pinned).map((uid) => ({ uid, ...r.get(uid) })).filter((x) => Number.isFinite(x.x));
    const moved = alignRects(list, mode).map((m) => ({ ...m, w: r.get(m.uid).w, h: r.get(m.uid).h }));
    void session.commitRects?.(moved);
  };
  const distributeSel = (axis, uids = selection.items) => {
    const r = rects();
    const b = board();
    const list = uids.filter((uid) => !b?.items.get(uid)?.pinned).map((uid) => ({ uid, ...r.get(uid) })).filter((x) => Number.isFinite(x.x));
    const moved = distributeRects(list, axis).map((m) => ({ ...m, w: r.get(m.uid).w, h: r.get(m.uid).h }));
    void session.commitRects?.(moved);
  };
  const wrapBoardSel = (uids = selection.items) => {
    if (!uids.length) return;
    Promise.resolve(session.wrapInBoard?.(uids)).then((uid) => { if (uid) ctl.select([uid]); }).catch(() => {});
  };
  const writeEdgeToGraph = async () => {
    if (!selection.edge) return;
    const r = await session.writeToGraph?.(selection.edge);
    chrome.toast.show({ message: r?.ok ? "Written to the graph" : `Not written: ${r?.reason || "unknown"}` });
  };
  const duplicate = (uids, { dx = 24, dy = 24, asRef = false } = {}) => {
    if (!uids.length) return;
    Promise.resolve(session.duplicateItems?.(uids, { dx, dy, asRef })).then(afterCreate("Duplicated")).catch(() => {});
  };
  const expandOutline = (uid, patch) => {
    const preset = patch ? writeMindPreset(storage, patch) : readMindPreset(storage);
    Promise.resolve(session.expandOutline?.(uid, preset)).then((res) => {
      if (disposed || !res || typeof res !== "object") return;
      if (res.added > 0) {
        if (res.skipped > 0) toast(`Mind map: ${res.total - res.skipped} of ${res.total} branches (cap)`, true);
        else toast(`Added ${res.added} ${res.added === 1 ? "card" : "cards"} as a mind map`, true);
      }
      else toast("Nothing to expand");
    }).catch(() => {});
  };
  const spreadChildren = (uid) => {
    Promise.resolve(session.spreadChildren?.(uid)).then((res) => {
      if (disposed || !res || typeof res !== "object") return;
      if (res.added > 0) toast(`Spread ${res.added} ${res.added === 1 ? "child" : "children"} as cards`, true);
      else toast(res.skipped > 0 ? "Every child is already on the board" : "No children to spread");
    }).catch(() => {});
  };
  const fitHeight = (uid) => {
    const h = itemsR.measureContent(uid);
    if (h) void session.fitToContent?.(uid, h);
    else toast("Zoom in to measure the card");
  };
  const startSendTo = (uids = selection.items) => {
    const list = uids.slice();
    if (!list.length) return;
    sendPending = list;
    panel.open("boards");
    toast(`Pick a board to send ${list.length} ${list.length === 1 ? "card" : "cards"} to`);
  };
  const finishSend = (uids, target) => {
    Promise.resolve(session.sendToBoard?.(uids, target)).then((res) => {
      if (disposed) return;
      if (res) { toast(`Added ${res.added} ${res.added === 1 ? "card" : "cards"} to ${res.title}`); panel.close(); }
      else toast("Couldn't send the cards to that board");
    }).catch(() => {});
  };
  const weekDates = () => {
    const d = new Date();
    const monday = d.getDate() - ((d.getDay() + 6) % 7);
    return Array.from({ length: 7 }, (_, i) => new Date(d.getFullYear(), d.getMonth(), monday + i));
  };
  const addDaily = (dates, at) => {
    Promise.resolve(session.addDailyCards?.(dates, { x: at.x, y: at.y })).then((made) => {
      if (disposed) return;
      if (Array.isArray(made) && made.length) ctl.select(made);
      else toast("Already on this board");
    }).catch(() => {});
  };
  // PG-4: a page search that adds [[Title]] as a page card. A page already on the board is selected and pulsed.
  let pagePicker = null;
  const addPage = (at = null) => {
    if (disposed) return;
    measure();
    const spot = at || screenToWorld(vp, { x: size.width / 2, y: size.height / 2 });
    pagePicker?.close();
    const picker = openPagePicker({
      doc,
      search: (text) => host?.searchPages?.(text, 30) || [],
      onPick: async (title) => {
        const b = board();
        if (!b || disposed) return false;
        for (const it of b.items.values()) {
          if (it.kind === "page" && it.target?.title === title) {
            ctl.select([it.uid]);
            pulseItem(it.uid);
            return true;
          }
        }
        const uid = await session.createCard?.({ x: spot.x - PAGE_CARD.w / 2, y: spot.y - PAGE_CARD.h / 2, string: `[[${title}]]`, w: PAGE_CARD.w, h: PAGE_CARD.h });
        if (uid && !disposed) ctl.select([uid]);
        return Boolean(uid);
      },
    });
    pagePicker = picker;
  };
  const outline = () => {
    const b = board();
    const out = [];
    if (!b) return out;
    for (const uid of outlineOrder(b)) {
      const it = b.items.get(uid);
      if (!it || it.type !== "section") continue;
      out.push({ uid, title: plainText(it.title || it.string, 80) || "Section", depth: it.depth, count: it.members.length, color: it.color || null });
    }
    return out;
  };

  // ------------------------------------------------------------ clipboard actions
  const pastePoint = () => {
    measure(); // the Roam page may have scrolled since the last measure
    const screen = pointerInside && lastPointer ? { x: lastPointer.x - rootRect.left, y: lastPointer.y - rootRect.top } : { x: size.width / 2, y: size.height / 2 };
    return screenToWorld(vp, screen);
  };
  const doCopy = (uids) => {
    const b = board();
    if (!b || !uids.length) return;
    const payload = copyPayload(b, uids, rects());
    if (!payload.text) return;
    lastPayload = payload;
    void writeClipboard({ text: payload.text, mime: PLEXUS_MIME, data: payload.mime }).then((ok) => { if (!disposed) toast(ok ? "Copied" : "Copy failed"); });
  };
  const pastePlexus = (data, { clone = false } = {}, at = pastePoint()) => {
    Promise.resolve(session.pasteItems?.(data, { x: at.x, y: at.y, mode: clone ? "clone" : "refs" })).then(afterCreate("Pasted")).catch(() => {});
  };
  const pasteEntries = (entries, at = pastePoint()) => {
    Promise.resolve(session.pasteText?.(entries, { x: at.x, y: at.y })).then(afterCreate("Pasted")).catch(() => {});
  };
  const pasteFromMenu = async (at, clone) => {
    let text = null;
    try { text = await globalThis.navigator?.clipboard?.readText?.(); } catch { text = null; }
    if (disposed) return;
    if (lastPayload && (text == null || text === lastPayload.text)) {
      let data = null;
      try { data = JSON.parse(lastPayload.mime); } catch { data = null; }
      if (data && Array.isArray(data.items)) { pastePlexus(data, { clone }, at); return; }
    }
    const entries = parsePastedText(text ?? "");
    if (entries.length) pasteEntries(entries, at);
    else toast("Nothing to paste");
  };
  const pasteImages = async (files, at = pastePoint()) => {
    if (!files?.length) return;
    if (typeof host?.uploadFile !== "function") { toast("Image upload is not available here"); return; }
    const urls = [];
    let failed = 0;
    for (const file of files) {
      try {
        urls.push(await host.uploadFile(file));
      } catch (err) {
        if (err?.message === "upload-unavailable") { if (!disposed) toast("Image upload is not available here"); return; }
        failed += 1;
      }
      if (disposed) return;
    }
    if (failed && !urls.length) { toast("Couldn't upload the image"); return; }
    if (!urls.length) return;
    const h = Number(setting("default-card-height", DEFAULT_SIZES.card.h)) || DEFAULT_SIZES.card.h;
    const made = await Promise.resolve(session.addRefCards?.(stackAt(urls.map((u) => `![](${u})`), at.x, at.y, h))).catch(() => null);
    if (disposed) return;
    if (Array.isArray(made) && made.length) { ctl.select(made); toast(failed ? `Added ${made.length} of ${files.length} images` : `Added ${made.length} ${made.length === 1 ? "image" : "images"}`, true); }
  };
  const editorTextarea = (node) => {
    if (!node) return null;
    if (String(node.tagName || "").toLowerCase() === "textarea") return node;
    const editor = node.closest?.(".pxd-item__editor");
    if (!editor) return null;
    const active = doc.activeElement;
    if (active && editor.contains?.(active) && String(active.tagName || "").toLowerCase() === "textarea") return active;
    return editor.querySelector?.("textarea") || null;
  };
  const remountEditor = async (cardUid) => {
    if (!cardUid || itemsR.editingUid?.() !== cardUid || disposed) return;
    await itemsR.exitEdit({ silent: true });
    if (disposed || !session.board?.items?.has?.(cardUid)) return;
    await itemsR.enterEdit(cardUid);
  };
  const pasteEditorImages = async (ta, blockUid, files) => {
    if (!files?.length || !blockUid) return;
    if (typeof host?.uploadFile !== "function") { toast("Image upload is not available here"); return; }
    const snap = { value: ta?.value ?? "", start: ta?.selectionStart, end: ta?.selectionEnd };
    const cardUid = itemsR.editingUid?.();
    const urls = [];
    let failed = 0;
    for (const file of files) {
      try { urls.push(await host.uploadFile(file)); }
      catch (err) {
        if (err?.message === "upload-unavailable") { if (!disposed) toast("Image upload is not available here"); return; }
        failed += 1;
      }
      if (disposed) return;
    }
    if (!urls.length) { if (!disposed) toast("Couldn't upload the image"); return; }
    // A drop on a card that is not being edited has no textarea; appending to an empty
    // snapshot would replace the block's text with the image.
    if (!ta) {
      let current = null;
      try { current = host?.blockString?.(blockUid); } catch { current = null; }
      if (typeof current !== "string") { if (!disposed) toast("Couldn't add the image to this card"); return; }
      snap.value = current;
      snap.start = snap.end = current.length;
    }
    const placed = inlineAtCaret(snap.value, snap.start, snap.end, imageMarkdown(urls));
    if (ta) {
      commitTextareaValue(ta, placed.string);
      try { ta.setSelectionRange?.(placed.caret, placed.caret); } catch { /* caret */ }
    }
    try {
      const write = () => host.updateString(blockUid, placed.string);
      if (host.group) await host.group(write);
      else await write();
    } catch { if (!disposed) toast("Couldn't upload the image"); return; }
    if (disposed) return;
    if (failed) toast(`Added ${urls.length} of ${files.length} images`);
    await remountEditor(cardUid);
  };
  const pasteEditorBlocks = async (ta, blockUid, plan) => {
    if (!blockUid || plan?.type !== "blocks") return;
    if (typeof host?.updateString !== "function" || typeof host?.createBlock !== "function") return;
    const cardUid = itemsR.editingUid?.();
    if (ta) commitTextareaValue(ta, plan.string);
    try {
      const write = async () => {
        await host.updateString(blockUid, plan.string);
        for (const line of plan.children) await host.createBlock({ parentUid: blockUid, order: "last", string: line });
      };
      if (host.group) await host.group(write);
      else await write();
    } catch { return; }
    if (disposed) return;
    await remountEditor(cardUid);
  };
  const editorPaste = (event) => {
    const ta = editorTextarea(event.target) || editorTextarea(doc.activeElement);
    if (!ta || !root.contains?.(ta)) return false;
    const files = filesFromDataTransfer(event.clipboardData);
    let text = "";
    try { text = event.clipboardData?.getData?.("text/plain") ?? ""; } catch { text = ""; }
    const cardUid = itemsR.editingUid?.();
    const role = inputBlockRole(ta, cardUid);
    const plan = editorPastePlan({
      text,
      imageCount: files.length,
      value: ta.value ?? "",
      selectionStart: ta.selectionStart,
      selectionEnd: ta.selectionEnd,
      isRoot: role.role === "root",
    });
    if (!plan || plan.type === "roam") return false;
    const blockUid = role.uid || cardUid;
    if (!blockUid) return false;
    if (plan.type === "images") { void pasteEditorImages(ta, blockUid, files); return true; }
    void pasteEditorBlocks(ta, blockUid, plan);
    return true;
  };

  // ------------------------------------------------------------ context menu
  // TSK-4. Status rows exist only while Task Status Tags exposes its API; every write goes through it.
  const statusWin = () => doc?.defaultView || globalThis;
  const statusTags = {
    available: () => Boolean(statusApi(statusWin())),
    palette: () => statusPalette(statusApi(statusWin())),
  };
  const taskUidOf = (it) => (it?.target?.kind === "block" && it.target.uid ? it.target.uid : it?.uid);
  const isTaskItem = (it) => Boolean(it) && isTaskString(it.string || (it.target?.kind === "block" ? host?.blockString?.(it.target.uid) : "") || "");
  const setStatusOf = async (uid, name) => {
    const api = statusApi(statusWin());
    if (!api || !uid) return { status: "unknown", reason: "no-api" };
    try { return await api.setStatus(uid, name); } catch { return { status: "unknown", reason: "set-status-failed" }; }
  };
  const trailRows = (b) => (b?.trails || []).map((t) => ({ uid: t.uid, name: t.name }));
  const menuContext = (kind, uid) => {
    const b = board();
    const item = uid ? b?.items.get(uid) : null;
    switch (kind) {
      case "canvas": return { canPaste: true, snapshots: b?.snapshots || [], taskTool: readSetting("task-tool") === true };
      case "board-menu": return { snapshots: b?.snapshots || [], dock: b?.plexus?.dock, readOpen: root.classList?.contains?.("pxd-root--read") === true, walk: true, hasTrail: Boolean(b?.trails?.length), lens: true, strength: strengthOn, dust: dustPeriod };
      case "card": {
        let queryText = item?.string || "";
        if (!isQueryString(queryText) && item?.target?.kind === "block") {
          try { queryText = host?.blockString?.(item.target.uid) || ""; } catch { queryText = ""; }
        }
        const canExpand = item?.kind === "page" || item?.kind === "note" || item?.kind === "block";
        const compassApi = globalThis.RoamCompass || globalThis.window?.RoamCompass || null;
        const plexusApi = globalThis.RoamPlexus || globalThis.window?.RoamPlexus || null;
        const task = isTaskItem(item) ? taskMeta(item.string, item.content) : null;
        const pdfUrl = item?.kind === "pdf" ? (pdfMacroUrl(item?.string || "") || "") : "";
        let officeText = item?.string || "";
        if (item?.target?.kind === "block") {
          try {
            const blockText = host?.blockString?.(item.target.uid);
            if (blockText) officeText = blockText;
          } catch { /* keep the card string */ }
        }
        const officeFile = officeTargetFromText(officeText);
        return { ...(task ? { statusTags, status: task.status || "" } : {}), item, regions: imageRegionRows(item?.content), canMakeTask: item?.type === "card" && item?.kind === "note" && !isTaskString(item.string) && !isQueryString(queryText), isBoard: item?.kind === "board", isPdf: item?.kind === "pdf", officeFile, hasParse: Boolean(pdfUrl) && readParsedUrls(storage).has(pdfUrl), inlineReader: item?.kind === "pdf" && itemsR.inlineUid?.() === item?.uid, collapsed: Boolean(item?.collapsed), pinned: Boolean(item?.pinned), hasOutline: NOTE_KINDS.includes(item?.kind), canSpread: item?.kind === "note" || item?.kind === "block", isQuery: isQueryString(queryText), canExpand, mindPreset: readMindPreset(storage), compass: typeof compassApi?.open === "function", interop: readSetting("interop") !== false, canAnnotate: item?.kind === "image" && typeof plexusApi?.create === "function", trails: trailRows(b), landmark: item?.landmark === true, landmarkSize: item?.size || "M" };
      }
      case "section": {
        const members = item && b ? [item.uid, ...descendantsOf(b, item.uid)] : [];
        return {
          item,
          count: item?.members?.length ?? 0,
          fitOn: item?.autofit !== false,
          pinned: Boolean(item?.pinned),
          collapsed: Boolean(item?.collapsed),
          hasNote: Boolean(item && sectionNoteUid(b, item.uid)),
          locked: members.length > 0 && members.every((u) => b.items.get(u)?.pinned),
          trails: trailRows(b),
          landmark: item?.landmark === true,
          landmarkSize: item?.size || "M",
          dateSource: dateMode,
        };
      }
      case "text": return { item, pinned: Boolean(item?.pinned), trails: trailRows(b), landmark: item?.landmark === true, landmarkSize: item?.size || "M" };
      case "edge": { const e = uid ? b?.edges.get(uid) : null; return { item: e, dir: e?.dir, route: e?.route, dash: e?.dash, blockEnd: Boolean(e?.fromBlock || e?.toBlock) }; }
      case "multi": {
        const items = selection.items.map((u) => b?.items.get(u)).filter(Boolean);
        return {
          ...(items.some(isTaskItem) ? { statusTags, status: "" } : {}),
          count: items.length,
          allPinned: items.length > 0 && items.every((i) => i.pinned),
          anyCollapsed: items.some((i) => i.type === "card" && i.collapsed),
          sectionPair: sectionPair(items.map((i) => i.uid), (id) => b?.items.get(id)),
          trails: trailRows(b),
        };
      }
      default: return {};
    }
  };
  const openMenuAt = (kind, uid, client, world) => {
    if (!board()) return false;
    const items = buildMenu(kind, menuContext(kind, uid));
    const ok = menu.open({ x: client.x, y: client.y, items });
    if (ok) menuCtx = { kind, uid, world, selection: selection.items.slice() };
    return ok;
  };
  const createAt = async (type, world) => {
    if (type === "sticky") {
      const d = STICKY_SIZE;
      const uid = await actions.createText({ x: world.x - d.w / 2, y: world.y - d.h / 2, look: "sticky" });
      if (uid && !disposed) { ctl.select([uid]); void enterEdit(uid); }
      return;
    }
    const d = DEFAULT_SIZES[type === "task" ? "card" : type];
    const at = { x: world.x - d.w / 2, y: world.y - d.h / 2 };
    const uid = await (type === "text" ? actions.createText(at) : type === "task" ? actions.createTask(at) : actions.createCard(at));
    if (uid && !disposed) { ctl.select([uid]); void enterEdit(uid); }
  };
  let openHalo = () => {};
  let closeHalo = () => {};
  let contextLineFor = async () => "";
  let bindInfoHover = () => {};
  const anydocHost = createAnydocHost();
  const showOffice = (res) => {
    if (disposed || !res) return;
    if (res.toast) toast(res.toast);
    if (Array.isArray(res.uids) && res.uids.length) ctl.select(res.uids);
    if (!res.more || !res.offer || typeof res.continue !== "function") return;
    const next = res.continue;
    chrome.toast.show({
      message: res.offer,
      action: {
        label: res.offer,
        run: () => {
          void Promise.resolve(next()).then(showOffice).catch(() => toast("Could not convert this file"));
        },
      },
    });
  };
  const runOffice = (office, world) => {
    if (!office) return;
    const point = world || viewCenterWorld();
    void handleOfficeDrop({
      office,
      convert: (bytes, format) => anydocHost.convert(bytes, format),
      fetch: doc.defaultView?.fetch?.bind(doc.defaultView),
      session,
      point,
    }).then(showOffice).catch(() => toast("Could not convert this file"));
  };
  const onMenuPick = (id) => {
    const b = board();
    if (!b || disposed) return;
    const mc = menuCtx || { kind: "canvas", uid: null, world: viewCenterWorld(), selection: [] };
    const world = mc.world || viewCenterWorld();
    const uids = mc.kind === "multi" ? selection.items.slice() : mc.uid && b.items.has(mc.uid) ? [mc.uid] : selection.items.slice();
    const item = uids.length === 1 ? b.items.get(uids[0]) ?? null : null;
    const edgeUid = mc.kind === "edge" ? mc.uid : selection.edge;
    const at = id.indexOf(":");
    const head = at < 0 ? id : id.slice(0, at);
    const arg = at < 0 ? null : id.slice(at + 1);
    switch (head) {
      case "status": {
        const name = arg === "remove" ? null : arg;
        const targets = uids.map((u) => b.items.get(u)).filter(isTaskItem).map(taskUidOf).filter(Boolean);
        if (!targets.length) break;
        if (targets.length === 1) {
          void setStatusOf(targets[0], name).then((res) => {
            if (res && res.status !== "updated" && res.status !== "unchanged") toast(`Status not changed: ${res.reason || res.status}`);
          });
        } else {
          const capped = targets.length > 45;
          void applyStatusPicks(targets, name, setStatusOf, null, (m) => toast(m?.message || String(m)))
            .then((res) => toast(`Status ${name ? `set to ${name}` : "removed"} on ${res.applied - res.rejected.length} cards${capped ? " (first 45 of the selection)" : ""}`));
        }
        break;
      }
      case "region-go":
      case "region-copy":
      case "region-rename":
      case "region-delete": {
        const region = imageRegionRows(item?.content).find((row) => row.uid === arg);
        if (head === "region-go") {
          if (region && item) view.applyShow({ kind: "img", f: region.f, cardUid: item.uid });
          break;
        }
        if (head === "region-copy") {
          if (arg) copyText(`((${arg}))`, "Reference copied");
          break;
        }
        if (head === "region-rename") {
          if (!region || !arg) break;
          askView({
            caption: region.caption,
            showCopy: false,
            dialogLabel: "Rename region",
            onSave: ({ caption }) => {
              let current = "";
              try { current = host?.blockString?.(arg) || ""; } catch { current = ""; }
              const next = renameRegionCaption(current, caption);
              if (!next || next === current || typeof host?.updateString !== "function") return;
              void host.updateString(arg, next);
            },
          });
          break;
        }
        if (!arg) break;
        let count = null;
        try {
          const raw = host?.q?.("[:find (count ?b) :in $ ?u :where [?r :block/uid ?u] [?b :block/refs ?r]]", arg);
          count = regionRefCount(raw);
        } catch { count = null; }
        const copy = regionDeleteCopy(count);
        if (copy == null) break;
        const remove = () => { if (typeof host?.deleteBlock === "function") void host.deleteBlock(arg); };
        if (!copy) { remove(); break; }
        closeRegionDelete();
        regionDelete = openRegionDeleteDialog(doc, {
          message: copy,
          onDelete: () => { closeRegionDelete(); remove(); },
          onOpen: () => { try { host?.openInSidebar?.(arg, "mentions"); } catch { /* sidebar missing */ } },
          onCancel: () => closeRegionDelete(),
        });
        root.append(regionDelete.el);
        regionDelete.focus?.();
        break;
      }
      case "new-card": void createAt("card", world); break;
      case "new-task": void createAt("task", world); break;
      case "make-task": if (item && item.type === "card" && item.kind === "note" && !isTaskString(item.string)) void makeTask(item.uid, item.string); break;
      case "new-text": void createAt("text", world); break;
      case "new-sticky": void createAt("sticky", world); break;
      case "new-section": {
        const d = DEFAULT_SIZES.section;
        Promise.resolve(session.createSection?.({ rect: { x: world.x - d.w / 2, y: world.y - d.h / 2, w: d.w, h: d.h } })).then((uid) => { if (uid && !disposed) ctl.select([uid]); }).catch(() => {});
        break;
      }
      case "new-lane-h":
      case "new-lane-v": {
        const vertical = head === "new-lane-v";
        const d = vertical ? LANE_SIZE.vertical : LANE_SIZE.horizontal;
        Promise.resolve(session.createSection?.({
          rect: { x: world.x - d.w / 2, y: world.y - d.h / 2, w: d.w, h: d.h },
          title: "Lane",
          look: "lane",
          axis: vertical ? "vertical" : "horizontal",
        })).then((uid) => { if (uid && !disposed) ctl.select([uid]); }).catch(() => {});
        break;
      }
      case "new-board": {
        const d = DEFAULT_BOARD_CARD;
        Promise.resolve(session.createBoard?.({ rect: { x: world.x - d.w / 2, y: world.y - d.h / 2, w: d.w, h: d.h } })).then((uid) => { if (uid && !disposed) ctl.select([uid]); }).catch(() => {});
        break;
      }
      case "new-drawing": {
        const d = DEFAULT_SIZES.card;
        Promise.resolve(session.createDrawing?.({ x: world.x - d.w / 2, y: world.y - d.h / 2 })).then((uid) => { if (uid && !disposed) ctl.select([uid]); }).catch(() => {});
        break;
      }
      case "new-table": {
        const d = TABLE_SIZE;
        Promise.resolve(session.createTable?.({ x: world.x - d.w / 2, y: world.y - d.h / 2, w: d.w, h: d.h })).then((uid) => { if (uid && !disposed) { freshItems.add(uid); ctl.select([uid]); } }).catch(() => {});
        break;
      }
      case "template": {
        const d = DEFAULT_BOARD_CARD;
        const rect = { x: world.x - d.w / 2, y: world.y - d.h / 2, w: d.w, h: d.h };
        Promise.resolve(session.insertTemplate?.(arg, rect)).then((uid) => { if (uid && !disposed) ctl.select([uid]); }).catch(() => {});
        break;
      }
      case "save-template":
        Promise.resolve(session.saveAsTemplate?.()).catch(() => {});
        break;
      case "save-snapshot":
        Promise.resolve(session.saveSnapshot?.()).catch(() => {});
        break;
      case "snapshot": {
        const snap = b.snapshots?.find((item) => item.uid === arg);
        const title = snap?.title || "this snapshot";
        chrome.toast.show({
          message: `Restore ${title}? Layouts are rewritten in groups of 45.`,
          action: { label: "Restore", run: () => { void session.restoreSnapshot?.(arg); } },
        });
        break;
      }
      case "delete-snapshot":
        Promise.resolve(session.deleteSnapshot?.(arg)).catch(() => {});
        break;
      case "save-view":
        saveCameraView();
        break;
      case "save-view-selection":
        saveSelectionView(uids);
        break;
      case "paste": void pasteFromMenu(world, false); break;
      case "paste-clone": void pasteFromMenu(world, true); break;
      case "select-all": ctl.select([...b.items.keys()]); break;
      case "fit-all": fitAll(); break;
      case "fold-all": void session.collapseAll?.(true); break;
      case "unfold-all": void session.collapseAll?.(false); break;
      case "add-today": addDaily([new Date()], world); break;
      case "add-page": addPage(world); break;
      case "add-week": addDaily(weekDates(), world); break;
      case "background": chrome.popover.open(); break;
      case "bar-table": setTable(!tableMode); break;
      case "bar-kanban": setKanban(!kanbanMode); break;
      case "bar-lens": toggleLens(); break;
      case "bar-focus": toggleFocus(); break;
      case "bar-present": startPresent(); break;
      case "dock": void session.setBoardBackground?.({ dock: arg === "default" ? null : arg }); break;
      case "bg-image": {
        void (async () => {
          let text = "";
          try { text = await globalThis.navigator?.clipboard?.readText?.() || ""; } catch { text = ""; }
          const ok = await session.setBoardBackground?.({ bgImage: text.trim() });
          if (!disposed && !ok) toast("Copy an https image URL first");
        })();
        break;
      }
      case "gallery":
      case "timeline":
      case "graph":
        if (tableMode) setTable(false);
        if (kanbanMode) setKanban(false);
        laterCtl.open(head);
        break;
      case "print": {
        const sheet = mountPrintSheet(doc, b);
        root.append(sheet);
        root.classList.add("pxd-root--print");
        try { win?.print?.(); } catch { /* the dialog is optional */ }
        sheet.remove();
        root.classList.remove("pxd-root--print");
        break;
      }
      case "highlights": {
        const on = root.classList.toggle("pxd-root--highlights");
        for (const card of b.items.values()) {
          const shell = itemsR.shellOf(card.uid);
          if (!shell) continue;
          shell.classList.toggle("pxd-has-highlight", on && highlightHits(card.string).length > 0);
        }
        break;
      }
      case "apply-template": if (item) void session.applyCardTemplate?.(item.uid, ATTRIBUTE_TEMPLATE); break;
      case "version-peek": {
        if (!versionPeekRequest(host?.api)) toast("Roam does not expose block history");
        else toast("Block history is available on this host");
        break;
      }
      case "date-source": {
        if (arg === "attribute" || arg === "first" || arg === "last") dateMode = arg;
        break;
      }
      case "layout-dates": {
        if (!item || item.type !== "section") break;
        const write = (rows) => {
          void session.layoutByDate?.(item.uid, { mode: dateMode, rows: aliasTimelineRows(rows) });
        };
        if (dateMode === "attribute" || (timelineRows && timelineCacheUid === b.uid)) write(timelineRows || []);
        else void loadTimelineRows().then((rows) => { if (!disposed) write(rows); });
        break;
      }
      case "lens-strength": {
        strengthOn = !strengthOn;
        void refreshStrength();
        break;
      }
      case "lens-dust": {
        const next = arg && arg !== "off" ? arg : "off";
        dustPeriod = next === "6 months" || next === "1 year" || next === "2 years" || next === "off" ? next : "off";
        void refreshDust();
        break;
      }
      case "focus-timer": {
        if (item?.type === "section") void session.setSectionLook?.(item.uid, "timer");
        stopTimer();
        timerState = { remainingMs: FOCUS_MS, running: true, endsAt: Date.now() + FOCUS_MS };
        timerHud = el("div", "pxd-timer pxd-chrome", root);
        paintTimer();
        armTimer();
        break;
      }
      case "group-connect": {
        const pair = sectionPair(uids, (id) => b.items.get(id));
        if (pair) void session.addEdge?.({ from: pair[0], to: pair[1] });
        break;
      }
      case "add-bend": {
        if (!edgeUid) break;
        const edge = b.edges.get(edgeUid);
        const a = rects().get(edge?.from);
        const c = rects().get(edge?.to);
        if (!edge || !a || !c) break;
        const mid = {
          x: (a.x + a.w / 2 + c.x + c.w / 2) / 2,
          y: (a.y + a.h / 2 + c.y + c.h / 2) / 2 - 48,
        };
        void session.updateEdge?.(edgeUid, { via: [...(edge.via || []), mid] });
        break;
      }
      case "clear-bends": if (edgeUid) void session.updateEdge?.(edgeUid, { via: [] }); break;
      case "export-svg": void view.exportSvg({ download: true }); break;
      case "export-png": void exportPng(); break;
      case "copy-png": {
        let ids = uids;
        if ((!ids || !ids.length) && mc.kind === "edge" && edgeUid) {
          const edge = b.edges.get(edgeUid);
          if (edge) ids = [edge.from, edge.to];
        }
        void copySelectionPng(ids);
        break;
      }
      case "copy-outline": void view.copyOutline(); break;
      case "open-outline": openBoardOutline(); break;
      case "edit": if (item) { if (item.kind === "board") itemsR.renameBoard(item.uid); else void enterEdit(item.uid); } break;
      case "open":
        if (item?.kind === "pdf") { try { itemsR.openPdf?.(item.uid); } catch { /* host */ } break; }
        openItem(item);
        break;
      case "open-own-page": openOwnPage(item); break;
      case "open-sidebar": openItemInSidebar(item); break;
      case "read-inline": {
        if (!item || item.kind !== "pdf") break;
        if (itemsR.inlineUid?.() === item.uid) itemsR.closeInline?.();
        else itemsR.readInline?.(item.uid);
        break;
      }
      case "parse-pdf": {
        if (!item || item.kind !== "pdf") break;
        try { itemsR.openPdf?.(item.uid); } catch { /* host */ }
        try { ensureReadPane().parse?.(); } catch { /* pane */ }
        break;
      }
      case "convert-office": {
        const office = menuContext("card", item?.uid).officeFile;
        if (office) runOffice(office, world);
        break;
      }
      case "open-parsed": {
        if (!item || item.kind !== "pdf") break;
        try { itemsR.openPdf?.(item.uid); } catch { /* host */ }
        try { ensureReadPane().showParsed?.(); } catch { /* pane */ }
        break;
      }
      case "hl-open": if (item) openHighlightAs(item, arg); break;
      case "open-compass": {
        if (!item) break;
        const api = globalThis.RoamCompass || globalThis.window?.RoamCompass || null;
        if (typeof api?.open !== "function") break;
        let uid = null;
        if (item.target?.kind === "page") uid = host?.pageUid?.(item.target.title) || null;
        else if (item.target?.kind === "block") uid = item.target.uid || null;
        else uid = item.uid || null;
        if (uid) api.open(uid);
        break;
      }
      case "annotate-drawing": {
        if (!item || item.kind !== "image") break;
        const api = globalThis.RoamPlexus || globalThis.window?.RoamPlexus || null;
        if (typeof api?.create !== "function") break;
        const live = rects().get(item.uid);
        const plan = annotatePlan({
          uid: item.uid,
          x: live?.x ?? item.x,
          y: live?.y ?? item.y,
          w: live?.w ?? item.w,
          h: live?.h ?? item.h,
        }, boardUid);
        // Create the drawing, then the ref card and the edge as one undo group. open only — never whenOpen.
        void (async () => {
          let made = null;
          try { made = await api.create(plan.create); } catch { return; }
          if (disposed) return;
          const drawingUid = typeof made === "string" ? made : made?.uid || null;
          const ref = drawingRefString(drawingUid);
          if (!drawingUid || !ref) return;
          const link = async () => {
            const placed = await Promise.resolve(session.addRefCards?.([{
              string: ref,
              x: plan.card.x,
              y: plan.card.y,
              w: plan.card.w,
              h: plan.card.h,
            }]));
            if (disposed) return;
            const refUid = Array.isArray(placed) ? placed[0] : placed || null;
            if (refUid) await Promise.resolve(session.addEdge?.({ from: refUid, to: plan.edge.to, label: plan.edge.label }));
          };
          await (host?.group ? host.group(link) : link());
          if (disposed) return;
          // openBlock leaves the board, so the board toast goes with it. Pin one on the page first.
          pinAnnotateToast(doc);
          toast("Drop the image into the drawing");
          if (typeof api.open === "function") api.open(drawingUid);
        })();
        break;
      }
      case "copy": doCopy(uids); break;
      case "copy-ref": if (item) copyText(`((${item.uid}))`, "Reference copied"); break;
      case "copy-link": {
        if (!item) break;
        let pageUid = "";
        try { pageUid = host?.blockPageUid?.(boardUid) || ""; } catch { pageUid = ""; }
        if (!pageUid) pageUid = pageUidFromHash(win?.location?.hash || "");
        copyText(copyLinkText(item, { graph, pageUid }), "Link copied");
        break;
      }
      case "duplicate": duplicate(uids); break;
      case "duplicate-ref": duplicate(uids, { asRef: true }); break;
      case "color": { const target = mc.kind === "edge" && edgeUid ? [edgeUid] : uids; if (target.length) void session.setColor?.(target, arg === "none" ? null : arg); break; }
      case "show-as-card": if (item) void session.setLook?.(item.uid, "card"); break;
      case "show-as-block": if (item) void session.setLook?.(item.uid, "block"); break;
      case "fold": setFolded(uids, true); break;
      case "unfold": setFolded(uids, false); break;
      case "fit-height": if (item) fitHeight(item.uid); break;
      case "reset-size": void session.resetSize?.(uids); break;
      case "pin": void session.setPinned?.(uids, true); break;
      case "unpin": void session.setPinned?.(uids, false); break;
      case "mind-map": if (item) expandOutline(item.uid); break;
      case "spread-children": if (item) spreadChildren(item.uid); break;
      case "neighbors": {
        if (!item || !arg) break;
        let titles = [];
        try { titles = host?.neighborPages?.(item, arg, { boardUid }) || []; } catch { titles = []; }
        const have = [];
        for (const other of b.items.values()) {
          if (other.target?.kind === "page" && other.target.title) have.push(other.target.title);
        }
        const list = neighborLayout(rects().get(item.uid), titles, { skip: have });
        if (!list.length) { toast("No pages to add"); break; }
        const made = session.addRefCards?.(list);
        Promise.resolve(made).then((ids) => {
          if (disposed) return;
          if (Array.isArray(ids) && ids.length) ctl.select(ids);
          toast(`Added ${list.length} ${list.length === 1 ? "page" : "pages"}`, true);
        }).catch(() => {});
        break;
      }
      case "query-results": {
        if (!item) break;
        const sourceUid = isQueryString(item.string) ? item.uid : (item.target?.kind === "block" ? item.target.uid : item.uid);
        const live = root.querySelector?.(`[data-uid="${item.uid}"] .pxd-item__query .pxd-rs__live`);
        const list = queryResultLayout(rects().get(item.uid), queryResultUids(live, sourceUid));
        if (!list.length) { toast("No results in this query"); break; }
        const made = session.addRefCards?.(list);
        Promise.resolve(made).then((ids) => {
          if (disposed) return;
          if (Array.isArray(ids) && ids.length) ctl.select(ids);
          toast(`Added ${list.length} ${list.length === 1 ? "card" : "cards"} from the query`, true);
        }).catch(() => {});
        break;
      }
      case "mind-dir": if (item && arg) expandOutline(item.uid, { direction: arg }); break;
      case "mind-space": if (item && arg) expandOutline(item.uid, { spacing: arg }); break;
      case "mind-depth": if (item && arg) expandOutline(item.uid, { depth: Number(arg) }); break;
      case "mind-refs": if (item && arg) expandOutline(item.uid, { includeRefs: arg !== "skip" }); break;
      case "mind-color": if (item && arg) expandOutline(item.uid, { colorBranches: arg === "on" }); break;
      case "send-to": startSendTo(uids); break;
      case "related": panel.open("related"); break;
      case "context": {
        const sub = edgeUid ? b.edges.get(edgeUid) : item;
        if (sub && sub.type !== "section") openHalo(sub);
        break;
      }
      case "delete": case "delete-frame": ctl.deleteSelection(false); break;
      case "delete-contents": ctl.deleteSelection(true); break;
      case "rename": if (item) itemsR.renameSection(item.uid); break;
      case "select-contents": if (item?.members?.length) ctl.select(item.members); break;
      case "select-all-in-section": {
        const all = item ? sectionAllUids(b, item.uid) : [];
        if (all.length) ctl.select(all);
        break;
      }
      case "select-same-color": {
        const same = item ? sameColorUids(b, item.uid) : [];
        if (same.length) ctl.select(same);
        break;
      }
      case "select-connected": {
        const linked = item ? connectedUids(b, item.uid) : [];
        if (linked.length) ctl.select(linked);
        break;
      }
      case "fit-section": if (item) void session.fitSection?.(item.uid); break;
      case "toggle-fit": if (item) void session.setFit?.(item.uid, item.autofit === false); break;
      case "tidy": void session.tidyItems?.(mc.kind === "board-menu" ? b.roots : uids, arg); break;
      case "sort-outline": void session.sortOutline?.(); break;
      case "fold-all-in": if (item) void session.collapseAll?.(true, { within: item.uid }); break;
      case "unfold-all-in": if (item) void session.collapseAll?.(false, { within: item.uid }); break;
      case "collapse-section": if (item?.type === "section") void session.setCollapsed?.(item.uid, !item.collapsed); break;
      case "section-note": if (item?.type === "section") void session.toggleSectionNote?.(item.uid); break;
      case "lock-contents": if (item?.type === "section") void session.lockSection?.(item.uid, true); break;
      case "unlock-contents": if (item?.type === "section") void session.lockSection?.(item.uid, false); break;
      case "present-section": if (item?.type === "section") startPresent(item.uid); break;
      case "size": if (item) void session.setFontSize?.(item.uid, Number(arg)); break;
      case "shape": if (item?.type === "text") void session.setItemStyle?.([item.uid], { shape: arg }); break;
      case "dir": if (edgeUid) void session.updateEdge?.(edgeUid, { dir: arg }); break;
      case "route": if (edgeUid) void session.updateEdge?.(edgeUid, { route: arg }); break;
      case "dash": if (edgeUid) void session.updateEdge?.(edgeUid, { dash: arg }); break;
      case "flip": if (edgeUid) void session.flipEdge?.(edgeUid); break;
      case "unblock": if (edgeUid) void session.updateEdge?.(edgeUid, { fromBlock: undefined, toBlock: undefined }); break;
      case "label": if (edgeUid) openWhy(edgeUid, "label"); break;
      case "edit-why": if (edgeUid) openWhy(edgeUid, "why"); break;
      case "memory-lane": toggleMemoryLane(); break;
      case "trail-add":
      case "trail-sel": {
        const targets = head === "trail-sel" ? uids.slice() : (item ? [item.uid] : []);
        const run = (trailUid) => {
          if (!trailUid) return;
          activeTrailUid = trailUid;
          if (head === "trail-sel") void session.addSelectionToTrail?.(trailUid, targets);
          else if (item) void session.addToTrail?.(trailUid, item.uid);
        };
        if (arg === "new") {
          askView({
            caption: "",
            showCopy: false,
            dialogLabel: "New trail",
            onSave: ({ caption }) => {
              activeTrailUid = null;
              Promise.resolve(session.createTrail?.(caption, targets)).then((id) => { if (id) activeTrailUid = id; }).catch(() => {});
            },
          });
        } else if (arg) run(arg);
        break;
      }
      case "landmark-toggle": if (item) void session.setLandmark?.(item.uid, { on: item.landmark !== true }); break;
      case "landmark-glyph": {
        if (!item) break;
        askView({
          caption: item.glyph || "",
          showCopy: false,
          dialogLabel: "Landmark glyph",
          onSave: ({ caption }) => { void session.setLandmark?.(item.uid, { on: true, glyph: caption }); },
        });
        break;
      }
      case "landmark-size": if (item && arg) void session.setLandmark?.(item.uid, { on: true, size: arg }); break;
      case "walk": {
        if (arg === "nearest") startWalk("nearest");
        else if (arg === "trail") startWalk("trail");
        else startWalk("reading");
        break;
      }
      case "notes": if (edgeUid) host?.openInSidebar?.(edgeUid, "block"); break;
      case "write-to-graph": void writeEdgeToGraph(); break;
      case "align": alignSel(arg, uids); break;
      case "distribute": distributeSel(arg, uids); break;
      case "same-size": if (uids.length) void session.sameSize?.(uids, uids[uids.length - 1], arg); break;
      case "wrap-section": if (uids.length) void session.wrapInSection?.(uids); break;
      case "wrap-board": wrapBoardSel(uids); break;
      default: break;
    }
  };

  // ------------------------------------------------------------ chrome + panel
  // Chrome is built before the panel, so Info is bound after createPanel.
  let openInfo = () => {};
  // Transient "next item" style from the dock options: per creation tool, in memory only, gone with the view.
  const pendingStyle = {};
  const pendingFor = (tool) => (ctl.getTool?.() === tool ? pendingStyle[tool] || null : null);
  const setPending = (key, value) => {
    const tool = ctl.getTool?.();
    if (!["card", "sticky", "section", "shape"].includes(tool)) return;
    const next = { ...(pendingStyle[tool] || {}) };
    if (value === null || value === undefined) delete next[key];
    else next[key] = value;
    pendingStyle[tool] = next;
    chrome.toolbar.setPending?.(pendingStyle);
  };
  let tooltipCheck = () => {};
  const blockTextareaFocused = (uid) => {
    const active = doc.activeElement;
    if (String(active?.tagName || "").toLowerCase() !== "textarea") return false;
    if (itemsR.editingUid?.() === uid) return true;
    const owner = typeof active.closest === "function" ? active.closest("[data-uid]") : null;
    const id = owner?.getAttribute?.("data-uid") || owner?.dataset?.uid;
    return id === uid;
  };
  // Named swatch in tag mode: one group holds the string rewrite and the fill clear.
  const setHighlighterTag = async (name) => {
    if (disposed || typeof name !== "string" || !/^[A-Za-z0-9_]+$/.test(name)) return;
    const item = barCard();
    if (!item) return;
    const uid = item.uid;
    if (blockTextareaFocused(uid)) return;
    let current = null;
    try { current = host?.blockString?.(uid); } catch { current = null; }
    if (typeof current !== "string") current = typeof item.string === "string" ? item.string : "";
    const next = rewriteBgTag(current, name);
    const clearFill = async () => {
      if (typeof session?.setItemStyle === "function") {
        await session.setItemStyle([uid], { fill: null });
        return;
      }
      if (typeof host?.pullProps !== "function" || typeof host?.updateProps !== "function") return;
      const full = readPlexus(host.pullProps(uid));
      if (!full || !Object.prototype.hasOwnProperty.call(full, "fill")) return;
      const props = { ...full };
      delete props.fill;
      await host.updateProps(uid, props);
    };
    const write = async () => {
      if (typeof session?.setString === "function") await session.setString(uid, next);
      else if (typeof host?.updateString === "function") await host.updateString(uid, next);
      await clearFill();
    };
    if (typeof host?.group === "function") await host.group(write);
    else await write();
  };
  // The gear stores the board flag. updateProps replaces the whole plexus, so the copy keeps every key.
  const writeHighlighterFlag = async (on) => {
    if (disposed) return;
    const flag = on === true;
    // A virtual board has no props yet: the session stamps the marker in the same undo step as the flag.
    if (board()?.virtual && typeof session?.setHighlighterTags === "function") {
      await session.setHighlighterTags(flag);
      return;
    }
    let base = null;
    try {
      if (typeof host?.pullProps === "function") base = readPlexus(host.pullProps(boardUid));
    } catch { base = null; }
    const live = board()?.plexus;
    if (!base || typeof base !== "object") base = live && typeof live === "object" ? live : null;
    if (live && typeof live === "object" && live.v === 2 && (!base || base.v !== 2)) base = live;
    if (!base || typeof base !== "object") return;
    if (board()?.enhanced && base.v !== 2) return;
    if (base.highlighterTags === flag) return;
    const next = { ...base, highlighterTags: flag };
    if (live && typeof live === "object") live.highlighterTags = flag;
    if (typeof host?.updateProps !== "function") return;
    try { await host.updateProps(boardUid, next); } catch { /* leave the board mounted */ }
  };
  const pdfSourceOfItem = (item) => {
    if (item?.target?.kind === "block") {
      const text = host?.blockString?.(item.target.uid);
      return typeof text === "string" ? text : "";
    }
    return typeof item?.string === "string" ? item.string : "";
  };
  // G2. The flipper is created the first time a PDF is selected or hovered, never on a note select.
  const pdfUrlOf = (uid) => {
    const item = board()?.items.get(uid);
    if (!item || item.kind !== "pdf" || item.collapsed) return "";
    return pdfMacroUrl(pdfSourceOfItem(item));
  };
  const ensurePdfFlip = () => {
    if (pdfFlip) return pdfFlip;
    pdfFlip = createPdfFlip({
      doc,
      win,
      timers,
      urlOf: pdfUrlOf,
      hostOf: (uid) => itemsR.shellOf?.(uid)?.querySelector?.(".pxd-pdf-paper") || null,
      sizeOf: (uid) => {
        const rect = rects().get(uid);
        if (!rect) return null;
        const z = Number(vp.zoom) || 1;
        return { cssW: rect.w * z, cssH: rect.h * z, dpr: Number(win?.devicePixelRatio) || 1 };
      },
      onLive: (on) => {
        if (!on) return;
        try { pdfWarm?.cancelAll?.(); } catch { /* warm */ }
      },
    });
    return pdfFlip;
  };
  const syncPdfFlip = () => {
    const items = selection.items;
    const primary = items.length ? items[items.length - 1] : "";
    const primaryItem = primary ? board()?.items.get(primary) : null;
    const hoverItem = pdfHoverUid ? board()?.items.get(pdfHoverUid) : null;
    if (primaryItem?.kind !== "pdf" && hoverItem?.kind !== "pdf" && !pdfFlip) return;
    ensurePdfFlip().assign({
      selected: primaryItem?.kind === "pdf" && !primaryItem.collapsed ? primary : "",
      hovered: hoverItem?.kind === "pdf" && !hoverItem.collapsed ? pdfHoverUid : "",
      lod: tier,
    });
    scheduleLift();
  };
  // The tool dock floats over the bottom of the board. When it sits on a hovered or selected PDF card, the card's
  // bottom controls (Open / Parse, page bar, badges) rise above it: --pxd-pdf-lift in world px on that card.
  let liftedUids = new Set();
  let liftHoverUid = "";
  // Measured in the next frame: a pane opening or a selection change must not force a layout synchronously.
  let liftFrame = null;
  const scheduleLift = () => {
    if (liftFrame || disposed) return;
    liftFrame = timers.frame(() => { liftFrame = null; liftPdfControls(); });
  };
  // Wheel pan/zoom never sets `gesturing`: measure once the wheel has been idle for LIFT_IDLE_MS instead of every frame.
  const LIFT_IDLE_MS = 120;
  let liftIdle = null;
  let liftBurst = false;
  const scheduleLiftIdle = () => {
    if (disposed) return;
    liftBurst = true;
    if (liftIdle) { liftIdle(); liftIdle = null; }
    liftIdle = timers.later(() => { liftIdle = null; liftBurst = false; scheduleLift(); }, LIFT_IDLE_MS);
  };
  const liftPdfControls = () => {
    if (disposed || gesturing) return;
    const want = new Map();
    // Only a hovered or selected PDF card has controls to lift: read no layout at all without one.
    const pdfCandidates = [];
    if (tier === "detail") {
      const ids = new Set([liftHoverUid, selection.items[selection.items.length - 1]].filter(Boolean));
      for (const uid of ids) {
        const item = board()?.items.get(uid);
        const r = item?.kind === "pdf" ? rects().get(uid) : null;
        if (r) pdfCandidates.push([uid, r]);
      }
    }
    const obstacles = [];
    if (pdfCandidates.length) {
      for (const sel of [".pxd-dock__bar", ".pxd-ctx", ".pxd-minimap"]) {
        const node = root.querySelector?.(sel);
        if (!node || node.style?.display === "none") continue;
        let r = null;
        try { r = node.getBoundingClientRect?.() || null; } catch { r = null; }
        if (r?.width && r?.height) obstacles.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
      }
      let clipBottom = Infinity;
      try { clipBottom = Number(viewport.getBoundingClientRect?.()?.bottom) || Infinity; } catch { clipBottom = Infinity; }
      const z = Number(vp.zoom) || 1;
      for (const [uid, r] of pdfCandidates) {
        const lift = pdfDockLift({
          left: rootRect.left + vp.x + r.x * z,
          top: rootRect.top + vp.y + r.y * z,
          w: r.w * z,
          h: r.h * z,
        }, obstacles, z, { clipBottom });
        if (lift > 0) want.set(uid, lift);
      }
    }
    for (const uid of liftedUids) {
      if (want.has(uid)) continue;
      itemsR.shellOf?.(uid)?.style?.removeProperty?.("--pxd-pdf-lift");
    }
    for (const [uid, lift] of want) itemsR.shellOf?.(uid)?.style?.setProperty?.("--pxd-pdf-lift", `${lift}px`);
    liftedUids = new Set(want.keys());
  };
  const pdfChipsFor = (item) => chipsForPdf(item, board()?.items, {
    source: pdfSourceOfItem,
    pageUid: (uid) => host?.blockPageUid?.(uid) || "",
    pageUrl: (uid) => host?.pdfPageUrl?.(uid) || "",
  });
  // PDFH-5, after the live trace (roadmap §8 "Run 4"): Roam's note button makes one empty child under the
  // highlight, opens the highlight in the right sidebar and focuses that child. Do the same: reuse the child
  // that is already there, create one only when there is none (one undo step), never touch :pdf-highlight.
  const openHighlightNote = async (hlUid) => {
    if (typeof hlUid !== "string" || !hlUid) return;
    const api = host?.api;
    let kids = [];
    try {
      kids = api?.data?.pull?.("[{:block/children [:block/uid :block/string :block/order :block/props]}]", [":block/uid", hlUid])?.[":block/children"] || [];
    } catch { kids = []; }
    const plan = noteActionPlan(kids);
    // Opening a sidebar window is itself a Roam undo entry. Open first, so the create is the top step
    // and one undo removes the new note (live 2026-10-06: the other order made undo close the window).
    const sidebar = api?.ui?.rightSidebar;
    try { await sidebar?.addWindow?.({ window: { type: "block", "block-uid": hlUid } }); } catch { return; }
    const noteUid = plan.kind === "focus" ? plan.uid : await session.addHighlightNote?.(hlUid);
    if (!noteUid || disposed) return;
    timers.later(() => {
      if (disposed) return;
      const win = (sidebar?.getWindows?.() || []).find((w) => w?.["block-uid"] === hlUid);
      const windowId = win?.["window-id"];
      if (!windowId) return;
      try { api?.ui?.setBlockFocusAndSelection?.({ location: { "block-uid": noteUid, "window-id": windowId } }); } catch { /* Roam focus */ }
    }, 200);
  };
  const openHighlightInReader = async (item) => {
    if (!item || item.kind !== "highlight" || !item.target?.uid) return;
    const pageUid = host?.blockPageUid?.(item.target.uid) || "";
    const url = pageUid ? (host?.pdfPageUrl?.(pageUid) || "") : "";
    const cards = [];
    for (const other of board()?.items.values() || []) {
      if (other?.kind !== "pdf") continue;
      cards.push({ uid: other.uid, source: pdfSourceOfItem(other) });
    }
    const match = pdfCardForUrl(url, cards);
    let blockUid = "";
    if (!match && url) {
      try { blockUid = host?.pdfBlockByUrl?.(url) || ""; } catch { blockUid = ""; }
    }
    const plan = readerJumpPlan({ cardUid: match || "", blockUid });
    const page = item.highlight?.page;
    if (plan.action === "card") {
      const pending = itemsR.openPdfAt?.(plan.uid, page, item.target.uid);
      itemsR.flash?.(item.uid);
      await pending;
      return;
    }
    if (plan.action === "block") {
      const pending = itemsR.openPdfBlock?.(plan.uid, page, `{{[[pdf]]: ${url}}}`, item.target.uid);
      itemsR.flash?.(item.uid);
      await pending;
      return;
    }
    try { host?.openBlock?.(item.target.uid); } catch { /* navigation can fail closed */ }
    toast(plan.toast);
  };
  // P32-4: one click on a highlight card opens it in one place. Shift-click is the sidebar (Roam's
  // convention); a plain click follows the setting; the chip's ▾ lists all three.
  const highlightOpenMode = () => (readSetting("highlight-open") === "sidebar" ? "sidebar" : "reader");
  const openHighlightAs = (item, mode) => {
    if (!item || item.kind !== "highlight") return;
    const pick = mode === "sidebar" || mode === "main" || mode === "reader" ? mode : highlightOpenMode();
    const uid = item.target?.uid || "";
    if (pick === "sidebar") {
      if (uid) { try { host?.openInSidebar?.(uid, "block"); } catch { /* host */ } }
      return;
    }
    if (pick === "main") {
      if (uid) { try { host?.openBlock?.(uid); } catch { /* host */ } }
      return;
    }
    void openHighlightInReader(item);
  };
  const openHighlightMenu = (item, anchor) => {
    if (!item || item.kind !== "highlight" || disposed) return false;
    let r = null;
    try { r = anchor?.getBoundingClientRect?.(); } catch { r = null; }
    const x = Number(r?.left) || 0;
    const y = (Number(r?.bottom) || 0) + 2;
    const items = [
      { id: "hl-open:reader", label: "Open in reader" },
      { id: "hl-open:sidebar", label: "Open in sidebar", hint: "Shift Click" },
      { id: "hl-open:main", label: "Open page in main" },
    ];
    const ok = menu.open({ x, y, items });
    if (ok) menuCtx = { kind: "card", uid: item.uid, world: viewCenterWorld(), selection: [] };
    return ok;
  };
  const chrome = createChrome({
    doc,
    root,
    version,
    settings: settingsProxy,
    timers,
    crumbs: crumbList,
    on: {
      chromeRebuilt: () => { tooltipCheck(); bindInfoHover(); },
      ctxPlaced: () => { if (liftedUids.size || liftHoverUid || selection.items.length) (liftBurst ? scheduleLiftIdle : scheduleLift)(); },
      openBoard: () => { const it = singleItem(); if (it) void openBoard(it.uid); },
      openOwnPage: () => openOwnPage(singleItem()),
      renameBoard: () => { const it = singleItem(); if (it) itemsR.renameBoard(it.uid); },
      crumb: (index) => { void goCrumb(index); },
      wrapBoard: () => wrapBoardSel(),
      saveViewSelection: () => saveSelectionView(selection.items.slice()),
      setTool: (tool, lock) => ctl.setTool(tool, lock),
      togglePanel: () => panel.toggle(),
      openInfo: () => openInfo(),
      cycleLinks: () => cycleLinks(),
      openLinksMenu: (anchor) => openLinksMenu(anchor),
      toggleTable: () => setTable(!tableMode),
      toggleKanban: () => setKanban(!kanbanMode),
      zoomIn: () => animateViewport(zoomAt(vp, { x: size.width / 2, y: size.height / 2 }, 1.2)),
      zoomOut: () => animateViewport(zoomAt(vp, { x: size.width / 2, y: size.height / 2 }, 1 / 1.2)),
      zoomReset: () => animateViewport(zoomAt(vp, { x: size.width / 2, y: size.height / 2 }, 1 / vp.zoom)),
      fit: () => fitAll(),
      toggleMinimap: () => chrome.minimap.setVisible(!chrome.minimap.isVisible()),
      toggleFullscreen: () => requestFullscreen(!isFullscreen),
      editBlock: () => editBoardBlock(),
      savePng: () => { void exportPng(); },
      openOutline: () => openBoardOutline(),
      setColor: (c) => {
        const uids = targetUids();
        if (uids.length) void session.setColor?.(uids, c);
        else setPending("color", c);
      },
      setHighlightColor: (name) => {
        const it = singleItem() || barCard();
        if (it?.kind !== "highlight" || !it.target?.uid) return;
        void session.setHighlightColor?.(it.target.uid, name);
      },
      openInReader: () => { void openHighlightInReader(singleItem() || barCard()); },
      onTag: (name) => { void setHighlighterTag(name); },
      onGear: (flag) => { void writeHighlighterFlag(flag); },
      tagMode: () => board()?.plexus?.highlighterTags === true,
      setLook: (look) => {
        if (selection.items.length) { for (const uid of selection.items) void session.setLook?.(uid, look); }
        else setPending("look", look);
      },
      setShape: (shape) => {
        if (selection.items.length) void session.setItemStyle?.(selection.items.slice(), { shape });
        else setPending("shape", shape);
      },
      edit: () => { const it = singleItem(); if (it) void enterEdit(it.uid); },
      openSidebar: () => openItemInSidebar(singleItem()),
      collapse: () => { const it = singleItem(); if (it) void session.setCollapsed?.(it.uid, !it.collapsed); },
      toggleOpen: () => {
        const it = barCard();
        if (!it) return;
        if (it.kind === "note" || it.kind === "block") itemsR.toggleKids(it.uid);
        else void session.setBlockOpen?.(it.uid, it.open === false);
      },
      showRefs: () => {
        const it = barCard();
        if (it?.target?.kind === "block" && it.target.uid) { openContexts(it.target.uid); return; }
        const uid = mentionsUid(it);
        if (uid) host?.openInSidebar?.(uid, "mentions");
      },
      related: () => panel.open("related"),
      delete: () => ctl.deleteSelection(false),
      rename: () => { const it = singleItem(); if (it) itemsR.renameSection(it.uid); },
      selectContents: () => { const it = singleItem(); if (it?.members?.length) ctl.select(it.members); },
      selectAllInSection: () => {
        const it = singleItem();
        const all = it ? sectionAllUids(board(), it.uid) : [];
        if (all.length) ctl.select(all);
      },
      selectSameColor: () => {
        const it = singleItem();
        const same = it ? sameColorUids(board(), it.uid) : [];
        if (same.length) ctl.select(same);
      },
      selectConnected: () => {
        const it = singleItem();
        const linked = it ? connectedUids(board(), it.uid) : [];
        if (linked.length) ctl.select(linked);
      },
      setFontSize: (n) => { const it = singleItem(); if (it) void session.setFontSize?.(it.uid, n); },
      edgeDir: (dir) => { if (selection.edge) void session.updateEdge?.(selection.edge, { dir }); },
      flip: () => { if (selection.edge) void session.flipEdge?.(selection.edge); },
      unblock: () => { if (selection.edge) void session.updateEdge?.(selection.edge, { fromBlock: undefined, toBlock: undefined }); },
      route: (route) => { if (selection.edge) void session.updateEdge?.(selection.edge, { route }); },
      dash: (dash) => { if (selection.edge) void session.updateEdge?.(selection.edge, { dash }); },
      weight: (weight) => { if (selection.edge) void session.updateEdge?.(selection.edge, { weight }); },
      label: () => { if (selection.edge) openWhy(selection.edge, "label"); },
      notes: () => { if (selection.edge) host?.openInSidebar?.(selection.edge, "block"); },
      writeToGraph: () => writeEdgeToGraph(),
      pinLink: () => {
        const link = (session.links || []).find((l) => l.key === selection.link);
        if (link) Promise.resolve(session.pinLink?.(link)).then((uid) => { if (uid) ctl.selectEdge(uid); }).catch(() => {});
      },
      openSource: (uid) => host?.openInSidebar?.(uid, "block"),
      align: (mode) => alignSel(mode),
      distribute: (axis) => distributeSel(axis),
      wrap: () => { if (selection.items.length) void session.wrapInSection?.(selection.items); },
      navigate: (worldPoint) => centerOn(worldPoint),
      searchFilter: (text) => searchFilter(text),
      searchNext: (dir) => searchNext(dir),
      searchClosed: () => { noteOverlayClosed(); try { root.focus({ preventScroll: true }); } catch { /* stub */ } },
      // 1.2
      pin: (on) => { if (selection.items.length) void session.setPinned?.(selection.items, Boolean(on)); },
      fitHeight: () => { const it = singleItem(); if (it) fitHeight(it.uid); },
      copyRef: () => { const it = singleItem(); if (it) copyText(`((${it.uid}))`, "Reference copied"); },
      markRegion: () => {
        const it = singleItem() || barCard();
        const area = it?.kind === "highlight" && it.highlight?.image === true;
        if (!it || (it.kind !== "image" && !area)) return;
        const card = root.querySelector(`[data-uid="${it.uid}"]`);
        const img = card?.querySelector?.("img.rm-inline-img");
        if (!img) { toast("The image is not ready"); return; }
        regionMark?.destroy?.();
        const cardUid = it.uid;
        const parentUid = area ? it.target?.uid : cardUid;
        if (!parentUid) { toast("The image is not ready"); return; }
        regionMark = mountRegionMark({
          doc,
          root,
          img,
          onConfirm: ({ frac, caption }) => {
            const uid = host.generateUid();
            try {
              const pending = navigator.clipboard.writeText(`((${uid}))`);
              if (pending && typeof pending.catch === "function") pending.catch(() => {});
            } catch { /* clipboard can be missing; the region write still runs */ }
            if (area) session.addHighlightRegion(parentUid, frac, caption, uid);
            else session.addImageRegion(cardUid, frac, caption, uid);
            toast("Region made, ref copied");
            regionMark = null;
          },
          onCancel: () => {
            regionMark?.destroy?.();
            regionMark = null;
          },
        });
      },
      duplicate: () => duplicate(selection.items),
      sendTo: () => startSendTo(),
      expandOutline: () => { const it = singleItem(); if (it) expandOutline(it.uid); },
      fitSection: () => { const it = singleItem(); if (it) void session.fitSection?.(it.uid); },
      toggleFit: () => { const it = singleItem(); if (it) void session.setFit?.(it.uid, it.autofit === false); },
      tidy: (mode) => { if (selection.items.length) void session.tidyItems?.(selection.items, mode); },
      foldAll: (value) => { const it = singleItem(); if (it) void session.collapseAll?.(Boolean(value), { within: it.uid }); },
      collapseSection: () => { const it = singleItem(); if (it?.type === "section") void session.setCollapsed?.(it.uid, !it.collapsed); },
      sectionNote: () => { const it = singleItem(); if (it?.type === "section") void session.toggleSectionNote?.(it.uid); },
      lockSection: (on) => { const it = singleItem(); if (it?.type === "section") void session.lockSection?.(it.uid, on !== false); },
      presentSection: () => { const it = singleItem(); if (it?.type === "section") startPresent(it.uid); },
      fold: (value) => setFolded(selection.items, Boolean(value)),
      sameSize: (mode) => { if (selection.items.length) void session.sameSize?.(selection.items, lastSelected(), mode); },
      toggleFocus: () => toggleFocus(),
      toggleLens: () => toggleLens(),
      present: () => startPresent(),
      openMore: ({ x, y } = {}) => { openMenuAt("board-menu", null, { x: x ?? 0, y: y ?? 0 }, viewCenterWorld()); },
      backToContent: () => fitAll(),
      setBackground: (patch) => {
        Promise.resolve(session.setBoardBackground?.(patch)).then((ok) => { if (ok === false && !disposed) toast("This board can't store a background"); }).catch(() => {});
      },
      useBackgroundAsDefault: () => {
        if (typeof onSetDefaults !== "function") return;
        onSetDefaults({ grid: bgPattern, "board-tone": bgTone || "none" });
        toast("Saved as the default background");
      },
    },
  });
  // PL-3: one hover tooltip for every chrome control, read live from the `tooltips` / `tooltip-delay` settings.
  const tooltip = createTooltip({ doc, root, timers, setting: readSetting });
  tooltipCheck = () => tooltip.check();
  const lensPop = el("div", "pxd-popover pxd-lens pxd-chrome", root);
  lensPop.style.display = "none";
  lensPop.setAttribute("role", "dialog");
  lensPop.setAttribute("aria-label", "Tag lens");
  let lensOffs = [];
  const closeLens = () => {
    lensOffs.splice(0).forEach((off) => off());
    lensPop.style.display = "none";
  };
  const paintLens = () => {
    const catalog = rebuildLens();
    lensPop.replaceChildren();
    const title = el("div", "pxd-popover__title", lensPop);
    title.textContent = "Tag lens";
    const all = el("button", `pxd-lens__row${lensTag ? "" : " is-on"}`, lensPop);
    all.type = "button";
    all.textContent = "All cards";
    all.setAttribute("aria-label", "All cards");
    all.dataset.tag = "";
    all.setAttribute("data-tag", "");
    if (!catalog.tags.length) {
      const empty = el("div", "pxd-lens__empty", lensPop);
      empty.textContent = "No tags on this board";
    }
    for (const tag of catalog.tags) {
      const label = lensRowLabel(tag);
      const row = el("button", `pxd-lens__row${tag === lensTag ? " is-on" : ""}`, lensPop);
      row.type = "button";
      row.textContent = label;
      row.setAttribute("aria-label", label);
      row.dataset.tag = tag;
      row.setAttribute("data-tag", tag);
    }
  };
  const openLens = () => {
    if (lensPop.style.display !== "none") { closeLens(); return; }
    paintLens();
    lensPop.style.display = "";
    const btn = chrome.toolbar.lensButton;
    const rootRect = root.getBoundingClientRect();
    const b = btn?.getBoundingClientRect?.() || { left: rootRect.left, top: rootRect.top, right: rootRect.left, bottom: rootRect.top };
    placeNearAnchor(lensPop, b, root, { gap: 6, skip: btn?.closest?.(".pxd-toolbar, .pxd-dock") || null });
    const onDown = (event) => {
      if (suspended) return;
      if (lensPop.contains(event.target) || btn?.contains?.(event.target)) return;
      closeLens();
    };
    const onKey = (event) => {
      if (suspended || event.key !== "Escape") return;
      event.preventDefault?.();
      event.stopPropagation?.();
      closeLens();
    };
    doc.addEventListener("pointerdown", onDown, true);
    doc.addEventListener("keydown", onKey, true);
    lensOffs = [() => doc.removeEventListener("pointerdown", onDown, true), () => doc.removeEventListener("keydown", onKey, true)];
  };
  const toggleLens = () => openLens();
  listen(lensPop, "click", (event) => {
    const row = event.target?.closest?.(".pxd-lens__row");
    if (!row || disposed) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    const tag = row.dataset?.tag || row.getAttribute?.("data-tag") || "";
    lensTag = tag || null;
    if (lensTag) rebuildLens();
    closeLens();
    focusKey = null;
    applyFocus();
  });

  let activeTrailUid = null;
  let trailPath = null;
  let trailD = "";
  let mmMarks = null;
  let mmSig = "";
  const currentTrail = (b) => {
    const trails = b?.trails || [];
    if (!trails.length) return null;
    return trails.find((t) => t.uid === activeTrailUid) || trails[0];
  };
  let askTrailName = () => {};
  let startWalk = () => {};
  const paintTrailPath = (b, shown) => {
    const trail = currentTrail(b);
    const pts = trail ? trailPoints(trail.stops, shown) : [];
    if (pts.length < 2) {
      if (trailPath) { trailPath.remove(); trailPath = null; trailD = ""; }
      return;
    }
    const d = pts.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ");
    if (!trailPath) {
      trailPath = doc.createElementNS(SVG_NS, "path");
      trailPath.setAttribute("class", "pxd-trail");
      trailPath.setAttribute("fill", "none");
      overlaySvg.append(trailPath);
    }
    if (d !== trailD) { trailD = d; trailPath.setAttribute("d", d); }
  };
  const syncTrailPaint = (b) => {
    if (!b || !itemsR) return;
    const trail = currentTrail(b);
    itemsR.setTrailBadges?.(trail ? trailBadges(trail) : new Map());
    paintTrailPath(b, paintRects());
  };
  // Overlay on the minimap element. The canvas clear lives in chrome.js and would wipe a canvas draw.
  const paintLandmarkDots = (b, shown) => {
    if (!landmarkUids(b).length) {
      if (mmMarks) { mmMarks.remove(); mmMarks = null; mmSig = ""; }
      return;
    }
    const dots = landmarkDots(b, shown, vp, size);
    const sig = dots.map((d) => `${d.uid}:${d.glyph}:${Math.round(d.x)}:${Math.round(d.y)}`).join("|");
    if (sig === mmSig && mmMarks) return;
    mmSig = sig;
    if (!mmMarks) mmMarks = el("div", "pxd-minimap__marks", chrome.minimap.el);
    mmMarks.replaceChildren();
    for (const dot of dots) {
      const n = el("span", "pxd-minimap__mark", mmMarks);
      n.textContent = dot.glyph || "•";
      n.style.left = `${dot.x}px`;
      n.style.top = `${dot.y}px`;
    }
  };
  const PANEL_WIDTH_KEY = "plexus-diagram:panel-width";
  let panelWidth = PANEL_WIDTH_DEFAULT;
  try {
    const stored = Number(storage?.getItem?.(PANEL_WIDTH_KEY));
    if (Number.isFinite(stored)) panelWidth = nextPanelWidth(stored, 0);
  } catch { /* private mode */ }
  const panel = createPanel({
    doc,
    root,
    host,
    timers,
    width: panelWidth,
    on: {
      addBeside: (string) => addStringsBeside([string]),
      addMany: (strings) => addStringsBeside(strings),
      isOnBoard,
      opened: (open) => { chrome.toolbar.setPanel(open); if (!open) sendPending = null; },
      listBoards: () => Promise.resolve(host?.listBoards?.()).then((rows) => rows || []),
      openBoardByUid: (uid) => {
        if (sendPending) { const list = sendPending; sendPending = null; finishSend(list, uid); return; }
        host?.openBlock?.(uid);
      },
      addBoardCard: (uid) => addStringsBeside([`((${uid}))`]),
      getOutline: () => outline(),
      outlineClick: (uid) => { fitSelection([uid]); ctl.select([uid]); },
      isFullscreen: () => isFullscreen,
      openSidebarEditor: (item) => openItemInSidebar(item),
      openRef: (uid) => host?.openInSidebar?.(uid, "block"),
      focusInfoTab: (uid) => ctl.select([uid]),
      rememberWidth: (w) => { try { storage?.setItem?.(PANEL_WIDTH_KEY, String(w)); } catch { /* private mode */ } },
      listViews: () => {
        const b = board();
        // Each map draws only the cards that meet its frame, 40 at most (the same filter as the region preview).
        return (b?.views || []).map((view) => ({ ...view, items: viewMapModel(b, view.v, view.ids).cards.map((card) => card.rect) }));
      },
      goView: (uid) => goToView(uid),
      copyView: (uid) => {
        try { globalThis.navigator?.clipboard?.writeText?.(`((${uid}))`); } catch { /* clipboard is a manual check */ }
      },
      renameView: (uid) => renameSavedView(uid),
      deleteView: (uid) => {
        Promise.resolve(session.deleteView?.(uid)).then(() => { if (!disposed) panel.refreshViews?.(); }).catch(() => {});
      },
      contextLine: (subject) => contextLineFor(subject),
      loadJournal: async (date) => {
        try {
          if (typeof host?.dailyBlocks === "function") return await Promise.resolve(host.dailyBlocks(date));
        } catch { /* a missing day is an empty list */ }
        return { rows: [] };
      },
      listTrails: () => board()?.trails || [],
      activeTrail: () => currentTrail(board())?.uid || "",
      stopTitle: (ref) => board()?.items.get(ref)?.title || ref,
      selectTrail: (uid) => { activeTrailUid = uid; syncTrailPaint(board()); },
      newTrail: () => askTrailName("", (caption) => {
        Promise.resolve(session.createTrail?.(caption)).then((id) => { if (id) activeTrailUid = id; }).catch(() => {});
      }),
      renameTrail: (uid) => {
        const trail = (board()?.trails || []).find((t) => t.uid === uid);
        askTrailName(trail?.name || "", (caption) => { void session.renameTrail?.(uid, caption); });
      },
      deleteTrail: (uid) => { void session.deleteTrail?.(uid); if (activeTrailUid === uid) activeTrailUid = null; },
      moveStop: (stopUid, index) => { void session.moveStop?.(stopUid, index); },
      walkTrail: (uid, fromRef) => { if (uid) activeTrailUid = uid; startWalk("trail", fromRef); },
      ensureTimeline: () => loadTimelineRows(),
      openDay: (pageUid) => { try { host?.openInSidebar?.(pageUid, "block"); } catch { /* host */ } },
      showOnBoard: (uids) => pulseTimeline(uids),
    },
  });
  let viewDialog = null;
  let regionDelete = null;
  const closeViewDialog = () => {
    viewDialog?.close();
    viewDialog = null;
  };
  const closeRegionDelete = () => {
    regionDelete?.close();
    regionDelete = null;
  };
  let cutting = false; // a cut carries its regions in the clip snapshot, so it does not ask
  const regionsLostBy = (uids) => {
    const b = board();
    let count = 0;
    let first = null;
    for (const uid of uids || []) {
      const item = b?.items.get(uid);
      if (item?.kind !== "image") continue;
      const rows = imageRegionRows(item.content);
      count += rows.length;
      first = first || rows[0]?.uid || null;
    }
    return { count, first };
  };
  const viewSize = () => (size.width > 0 && size.height > 0 ? size : { width: 800, height: 560 });
  const sectionCaptions = () => {
    const b = board();
    if (!b) return [];
    const world = rects();
    const out = [];
    for (const item of b.items.values()) {
      if (item.type !== "section") continue;
      out.push({ title: item.title, rect: world.get(item.uid) });
    }
    return out;
  };
  askTrailName = (caption, onSave) => {
    askView({
      caption: caption || "",
      showCopy: false,
      dialogLabel: "Trail name",
      onSave: ({ caption: next }) => onSave?.(next),
    });
  };
  const askView = ({ caption, showCopy, dialogLabel, onSave }) => {
    closeViewDialog();
    viewDialog = openViewDialog(doc, {
      caption,
      showCopy,
      dialogLabel,
      onSave: (result) => {
        closeViewDialog();
        onSave(result);
      },
      onCancel: () => closeViewDialog(),
    });
    root.append(viewDialog.el);
    viewDialog.focus();
  };
  const commitView = ({ caption, v, ids, copy }) => {
    const pending = session.addView?.({ caption, v, ids });
    if (copy && pending?.uid) {
      try { globalThis.navigator?.clipboard?.writeText?.(`((${pending.uid}))`); } catch { /* clipboard is a manual check */ }
    }
    Promise.resolve(pending).then(() => { if (!disposed) panel.refreshViews?.(); }).catch(() => {});
  };
  const saveCameraView = () => {
    const b = board();
    if (!b || disposed) return;
    const rect = visibleWorldRect(vp, viewSize(), 0);
    const centerPt = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
    askView({
      caption: captionForView(sectionCaptions(), centerPt, b.title),
      showCopy: true,
      onSave: ({ caption, copy }) => commitView({ caption, v: rect, ids: [], copy }),
    });
  };
  const saveSelectionView = (picked) => {
    const b = board();
    if (!b || disposed) return;
    const list = (picked || []).filter((id) => b.items.has(id)).slice(0, 24);
    const world = list.map((id) => rects().get(id)).filter(Boolean);
    const rect = selectionViewRect(world);
    if (!rect) return;
    const centerPt = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
    askView({
      caption: captionForView(sectionCaptions(), centerPt, b.title),
      showCopy: true,
      onSave: ({ caption, copy }) => commitView({ caption, v: rect, ids: list, copy }),
    });
  };
  const renameSavedView = (uid) => {
    const view = board()?.views?.find((row) => row.uid === uid);
    if (!view) return;
    askView({
      caption: view.caption,
      showCopy: false,
      onSave: ({ caption }) => {
        Promise.resolve(session.renameView?.(uid, caption)).then(() => { if (!disposed) panel.refreshViews?.(); }).catch(() => {});
      },
    });
  };
  const goToView = (uid) => {
    const view = board()?.views?.find((row) => row.uid === uid);
    if (!view?.v) return;
    const next = viewportFromWorldRect({ x: view.v[0], y: view.v[1], w: view.v[2], h: view.v[3] }, viewSize());
    if (next) setViewport(next);
  };
  openInfo = () => {
    const it = singleItem();
    if (it && it.type !== "section") panel.addInfoTab(it);
    else panel.open("info");
  };
  const propsPanel = createPropsPanel({
    doc,
    root,
    storage,
    on: {
      setItemStyle: (patch) => { if (selection.items.length) void session.setItemStyle?.(selection.items, patch); },
      resetItems: () => { if (selection.items.length) void session.resetItemStyle?.(selection.items); },
      setSectionStyle: (patch) => { if (selection.items.length) void session.setSectionStyle?.(selection.items, patch); },
      resetSections: () => { if (selection.items.length) void session.resetSectionStyle?.(selection.items); },
      setEdge: (patch) => { if (selection.edge) void session.updateEdge?.(selection.edge, patch); },
      resetEdge: () => { if (selection.edge) void session.updateEdge?.(selection.edge, { dir: "one", route: "curve", dash: "solid", weight: 1, color: null }); },
      setDefaults: (patch) => { void session.setSectionDefaults?.(patch); },
      resetDefaults: () => { void session.resetSectionDefaults?.(); },
      setBackground: (patch) => {
        Promise.resolve(session.setBoardBackground?.(patch)).then((ok) => { if (ok === false && !disposed) toast("This board can't store a background"); }).catch(() => {});
      },
    },
  });
  const syncProps = () => {
    const b = board();
    if (!b) return;
    propsPanel.refresh({
      items: selection.items.map((id) => b.items.get(id)).filter(Boolean),
      edge: selection.edge ? b.edges.get(selection.edge) : null,
      board: b,
    });
  };
  const menu = createMenu({ doc, root, on: { pick: (id) => onMenuPick(id), closed: () => { menuCtx = null; } } });
  const quicklook = createQuickLook({
    doc,
    root,
    host,
    timers,
    on: {
      getRefCount: (item) => badgeCache.get(badgeKeyOf(item))?.stats?.refs,
      titleOf: (item) => pdfDisplayTitle(item),
      pdfOf: (item) => ({ url: pdfUrlOf(item.uid), page: pdfFlip?.pageOf?.(item.uid) || 1 }),
    },
  });
  const presenter = createPresenter({
    doc,
    root,
    timers,
    on: {
      step: (s) => { presentSet = s.members; fitTo(s.rect, { maxZoom: 1.2 }); applyFocus(); },
      exit: () => { presentSet = null; applyFocus(); },
    },
  });
  const startPresent = (only) => {
    quicklook.close();
    const opts = only ? { only } : undefined;
    if (!presenter.start(board(), rects(), opts)) toast("Nothing to present");
  };
  startWalk = (mode, fromRef) => {
    quicklook.close();
    const b = board();
    if (!b) return false;
    const world = rects();
    const vis = visibleWorldRect(vp, viewSize(), 0);
    let stops = walkStops(b, world, { mode, screen: vis, trail: currentTrail(b) });
    if (fromRef) {
      const at = stops.findIndex((stop) => stop.uid === fromRef);
      if (at > 0) stops = stops.slice(at);
    }
    if (!presenter.start(b, world, { stops })) { toast("Nothing to walk"); return false; }
    return true;
  };
  chrome.minimap.setVisible(setting("show-minimap", true) !== false);
  chrome.toolbar.setLinkMode(linkMode);

  const cycleLinks = () => {
    linkMode = LINK_MODES[(LINK_MODES.indexOf(linkMode) + 1) % LINK_MODES.length];
    chrome.toolbar.setLinkMode(linkMode);
    session.setLinkMode?.(linkMode);
  };

  // Legend visibility is view state. Hiding a name filters the paint; it does not write.
  const hiddenAttrs = new Set();
  const legend = el("div", "pxd-legend pxd-chrome", root);
  legend.hidden = true;
  legend.setAttribute("hidden", "");
  const attrStyleMap = () => parseAttrStyles(setting("attr-styles", ""));
  const paintedLinks = () => styleAttrLinks(session.links || [], attrStyleMap(), hiddenAttrs);
  const paintLegend = () => {
    const rows = attrLegend(session.links || [], hiddenAttrs, attrStyleMap());
    legend.replaceChildren();
    if (!rows.length) {
      legend.hidden = true;
      legend.setAttribute("hidden", "");
      return;
    }
    legend.hidden = false;
    legend.removeAttribute("hidden");
    for (const row of rows) {
      const btn = doc.createElement("button");
      btn.type = "button";
      btn.className = `pxd-legend__row pxd-c-${row.color}${row.on ? "" : " is-off"}`;
      btn.setAttribute("data-attr", row.name);
      btn.setAttribute("aria-pressed", row.on ? "true" : "false");
      btn.title = row.on ? `Hide ${row.name}` : `Show ${row.name}`;
      btn.setAttribute("aria-label", btn.title);
      btn.textContent = row.name;
      legend.append(btn);
    }
  };
  listen(legend, "click", (ev) => {
    const btn = ev.target?.closest?.(".pxd-legend__row");
    if (!btn || disposed) return;
    ev.preventDefault();
    ev.stopPropagation();
    const name = btn.getAttribute("data-attr") || "";
    if (!name) return;
    if (hiddenAttrs.has(name)) hiddenAttrs.delete(name);
    else hiddenAttrs.add(name);
    if (selection.link) {
      const current = (session.links || []).find((l) => l.key === selection.link);
      const shown = current?.kind === "attr" ? current.labels?.[0] : "";
      if (shown && hiddenAttrs.has(shown)) selection.link = null;
    }
    dirty.links = true;
    dirty.selection = true;
    schedule();
  });

  // ------------------------------------------------------------ board search
  const nestedBoards = (b) => {
    const out = [];
    if (!b || typeof host?.pullBoard !== "function") return out;
    const seen = new Set();
    for (const item of b.items.values()) {
      const target = item.kind === "board" ? item.uid : (item.kind === "block" ? boardTargetOf(item.uid) : null);
      if (!target || target === b.uid || seen.has(target)) continue;
      seen.add(target);
      let raw = null;
      try { raw = host.pullBoard(target); } catch { raw = null; }
      if (!raw) continue;
      let child = null;
      try { child = buildBoard(raw); } catch { child = null; }
      if (child?.items) out.push({ parentUid: item.uid, board: child });
    }
    return out;
  };
  const paintSearch = (b, hits, q) => {
    const bright = new Set((hits || []).map((h) => h.focus));
    for (const item of b?.items.values() || []) {
      const shell = itemsR.shellOf(item.uid);
      const on = Boolean(q) && bright.has(item.uid);
      shell?.classList.toggle("pxd-item--dim", Boolean(q) && !on);
      shell?.classList.toggle("pxd-item--hit", on);
    }
    const edges = q ? new Set((hits || []).filter((h) => h.kind === "edge").map((h) => h.uid)) : null;
    edgesR.setSearch(edges);
  };
  const searchFilter = (text) => {
    const b = board();
    const q = String(text || "").trim().toLowerCase();
    searchIndex = -1;
    root.classList.toggle("pxd-root--searching", Boolean(q));
    searchMatches = b && q ? findOnBoard(b, q, nestedBoards(b), (uid) => host?.blockString?.(uid)) : [];
    paintSearch(b, searchMatches, q);
    return searchMatches.length;
  };
  const searchNext = (dir = 1) => {
    if (!searchMatches.length) return;
    searchIndex = (searchIndex + dir + searchMatches.length) % searchMatches.length;
    const hit = searchMatches[searchIndex];
    if (hit?.focus && board()?.items.has(hit.focus)) {
      ctl.select([hit.focus]);
      fitSelection([hit.focus]);
    }
    const countEl = root.querySelector(".pxd-search__count");
    if (countEl) countEl.textContent = `${searchIndex + 1}/${searchMatches.length}`;
  };

  // ------------------------------------------------------------ editing
  const enterEdit = async (uid, opts) => {
    ctl.select([uid]);
    // Editing at map zoom is unreadable: bring the card to a working zoom first.
    if (tier !== "detail") { fitSelection([uid]); applyLod(); }
    const ok = await itemsR.enterEdit(uid, opts);
    if (ok) {
      chrome.ctx.hide();
      typeAhead.flush(doc.activeElement);
    } else typeAhead.cancel();
    return ok;
  };
  // Cards/text created by a gesture and left empty are removed on edit exit (no junk cards).
  const freshItems = new Set();
  const freshTasks = new Set();
  const defaultTaskProject = () => String(setting("task-default-project", "") || "").trim().replace(/^\[\[|\]\]$/g, "");
  // The default project is applied once, when the new task has text, through Better Tasks.
  const settleFreshTask = (uid) => {
    if (!freshTasks.delete(uid)) return;
    const project = defaultTaskProject();
    if (!project || !bt.available()) return;
    const text = host?.blockString?.(uid);
    if (!isTaskString(text) || isBareTask(text)) return;
    void bt.modify(uid, { attributes: { project } });
  };
  const makeTask = async (uid, string) => {
    await session.setString?.(uid, `{{[[TODO]]}} ${String(string || "").trim()}`.trimEnd());
    const project = defaultTaskProject();
    if (project && bt.available()) void bt.modify(uid, { attributes: { project } });
  };
  const exitEdit = async () => {
    const uid = itemsR.editingUid?.();
    const editorText = editingPlainText(root);
    await itemsR.exitEdit();
    if (uid && freshItems.delete(uid)) {
      const item = session.board?.items?.get(uid);
      const text = host?.blockString?.(uid);
      if (item && freshCardIsBlank({
        blockString: text,
        itemString: item.string,
        contentCount: (item.content || []).filter((c) => !isTaskAttr(c)).length,
        editorText,
      })) {
        freshTasks.delete(uid);
        await session.deleteItems?.([uid]);
      }
    }
    if (uid) settleFreshTask(uid);
    if (!disposed) { dirty.selection = true; schedule(); }
  };

  // ------------------------------------------------------------ fullscreen
  // The strip lives inside .pxd-root so chrome tokens and overlay hit-testing apply. Leaving fullscreen keeps the list.
  let tabStrip = null;
  const paintTabStrip = (tabs, current) => {
    // P32-6: one tab is just the board you are on. The strip shows from two tabs up; the list,
    // its persistence and Cmd+1..9 do not depend on the strip being painted.
    if (!isFullscreen || !Array.isArray(tabs) || tabs.length < 2) {
      tabStrip?.remove();
      tabStrip = null;
      root.classList.remove("pxd-root--fstabs");
      root.style.setProperty("--pxd-tabs-h", "0px");
      return;
    }
    root.classList.add("pxd-root--fstabs");
    if (!tabStrip || !root.contains(tabStrip)) {
      // A nested board opened in place reuses this root; a strip the previous view left must not stay.
      for (const stray of root.querySelectorAll?.(".pxd-fstabs") || []) if (stray.parentElement === root) stray.remove();
      tabStrip = el("div", "pxd-fstabs pxd-chrome");
      tabStrip.setAttribute("role", "tablist");
      tabStrip.setAttribute("aria-label", "Boards");
      // .pxd-chrome already keeps the board's own pointer handling off the strip; one tracked click listener.
      listen(tabStrip, "click", (event) => {
        event.preventDefault?.();
        event.stopPropagation();
        const closer = event.target?.closest?.(".pxd-fstab__x");
        const tab = event.target?.closest?.(".pxd-fstab");
        const uid = (closer || tab)?.getAttribute?.("data-uid");
        if (!uid) return;
        if (closer) closeFullscreenTab(uid);
        else selectFullscreenTab(uid);
      });
      root.prepend(tabStrip);
    }
    tabStrip.replaceChildren();
    for (const tab of tabs) {
      const on = tab.uid === current;
      const node = el("div", `pxd-fstab${on ? " pxd-fstab--on" : ""}`, tabStrip);
      node.setAttribute("role", "tab");
      node.setAttribute("data-uid", tab.uid);
      node.dataset.uid = tab.uid;
      node.setAttribute("aria-selected", on ? "true" : "false");
      const name = el("span", "pxd-fstab__name", node);
      name.textContent = tab.title || "Untitled board";
      const x = el("button", "pxd-btn pxd-fstab__x", node);
      x.type = "button";
      x.textContent = "×";
      x.setAttribute("aria-label", `Close ${tab.title || "board"}`);
      x.setAttribute("data-uid", tab.uid);
    }
    const h = Math.round(Number(tabStrip.offsetHeight) || 0);
    root.style.setProperty("--pxd-tabs-h", `${h > 0 ? h : 0}px`);
  };
  const selectFullscreenTab = (uid) => {
    if (!uid || uid === (board()?.uid || boardUid)) return;
    onSelectTab?.(uid);
  };
  const closeFullscreenTab = (uid) => {
    const next = closeBoardTab(uid);
    const tabs = next?.tabs || [];
    const current = board()?.uid || boardUid;
    if (uid !== current) {
      paintTabStrip(tabs, current);
      return;
    }
    const neighbor = next?.index >= 0 ? tabs[next.index] : null;
    paintTabStrip(tabs, neighbor?.uid || "");
    if (neighbor?.uid && neighbor.uid !== current) onSelectTab?.(neighbor.uid);
  };
  const syncFullscreenTabs = () => {
    if (!isFullscreen) {
      paintTabStrip([], "");
      return;
    }
    const b = board();
    const entry = { uid: b?.uid || boardUid, title: b?.title || "" };
    let next = openBoardTab(entry);
    // A board deleted since it was opened (or a test board cleaned up) drops out of the list.
    const exists = (uid) => {
      if (typeof host?.blockExists !== "function") return true;
      try { return host.blockExists(uid) !== false; } catch { return true; }
    };
    for (const tab of [...(next?.tabs || [])]) {
      if (tab.uid !== entry.uid && !exists(tab.uid)) next = closeBoardTab(tab.uid) || next;
    }
    paintTabStrip(next?.tabs || [], entry.uid);
  };
  const applyFullscreen = (on) => {
    isFullscreen = Boolean(on);
    fsDispose();
    fsDispose = applyFullscreenChrome(mountEl, isFullscreen, doc);
    root.classList.toggle("pxd-root--fullscreen", isFullscreen);
    chrome.toolbar.setFullscreen(isFullscreen);
    resizeGrip.style.display = isFullscreen ? "none" : "";
    if (isFullscreen) { root.style.height = ""; }
    else applyInlineHeight();
    syncFullscreenTabs();
    timers.frame(() => { measure(); markViewport(); });
  };
  const requestFullscreen = (on) => {
    applyFullscreen(on);
    onRequestFullscreen?.(Boolean(on));
  };

  // Inline "Edit Block": the raw {{[[diagram]]}} textarea. Esc unmounts it and the canvas is still here.
  let blockEdit = null;
  const closeBlockEdit = () => {
    if (!blockEdit) return;
    const node = blockEdit;
    blockEdit = null;
    node.remove();
    try { host?.unmount?.(node); } catch { /* not mounted */ }
  };
  const editBoardBlock = () => {
    if (blockEdit || disposed) return;
    const node = el("div", "pxd-block-edit pxd-chrome", root);
    for (const type of ["pointerdown", "pointerup", "mousedown", "click", "dblclick", "wheel"]) {
      node.addEventListener(type, (event) => event.stopPropagation());
    }
    blockEdit = node;
    try { host?.renderBlock?.(node, boardUid); }
    catch { closeBlockEdit(); return; }
    openRawBlockEditor(node);
  };
  // renderBlock shows the diagram. Native's own Edit Block control turns that into the raw textarea.
  const openRawBlockEditor = (node) => {
    if (node.querySelector?.("textarea")) return;
    const buttons = [...(node.querySelectorAll?.("button") || [])];
    const native = buttons.find((b) => (b.getAttribute?.("title") || b.title) === "Edit Block");
    if (!native) return;
    native.click?.();
    if (node.querySelector?.("textarea")) return;
    const propsKey = Object.keys(native).find((k) => k.startsWith("__reactProps"));
    const onClick = propsKey && native[propsKey]?.onClick;
    if (typeof onClick === "function") {
      onClick({ preventDefault() {}, stopPropagation() {}, target: native, currentTarget: native });
    }
  };

  // ------------------------------------------------------------ inline height
  const readHeight = () => {
    try { const v = Number(storage?.getItem?.(heightKey)); return Number.isFinite(v) && v >= MIN_HEIGHT ? v : Number(setting("default-height", DEFAULT_HEIGHT)) || DEFAULT_HEIGHT; } catch { return DEFAULT_HEIGHT; }
  };
  const applyInlineHeight = (h = readHeight()) => {
    root.style.height = `${h}px`;
    if (mountEl?.style) { mountEl.style.height = `${h}px`; mountEl.style.minHeight = `${h}px`; }
  };
  let heightDrag = null;
  const onHeightMove = (event) => {
    if (suspended || !heightDrag) return;
    const h = Math.max(MIN_HEIGHT, Math.round(heightDrag.h0 + (event.clientY - heightDrag.y0)));
    heightDrag.h = h;
    applyInlineHeight(h);
  };
  const onHeightUp = () => {
    if (suspended || !heightDrag) return;
    try { storage?.setItem?.(heightKey, String(heightDrag.h)); } catch { /* quota */ }
    heightDrag = null;
    doc.removeEventListener("pointermove", onHeightMove, true);
    doc.removeEventListener("pointerup", onHeightUp, true);
    measure();
    markViewport();
  };
  listen(resizeGrip, "pointerdown", (event) => {
    event.stopPropagation();
    event.preventDefault();
    heightDrag = { y0: event.clientY, h0: rootRect.height || readHeight(), h: rootRect.height || readHeight() };
    doc.addEventListener("pointermove", onHeightMove, true);
    doc.addEventListener("pointerup", onHeightUp, true);
  });

  // ------------------------------------------------------------ section auto-fit preview
  // While items are dragged or resized, sections that must grow around them are shown grown (shells only).
  // Nothing is written: the commit runs the real fit in one transaction, cancel snaps the shells back.
  const resetGrown = () => {
    if (!grown.size) return;
    const ids = [...grown];
    grown = new Set();
    itemsR.resetRects(rects(), ids);
  };
  const previewFit = (touched, { parentOf, skip } = {}) => {
    const b = board();
    if (!b || !flag("auto-fit-sections", true)) return;
    const plan = touched.length ? sectionFitPlan(b, effectiveRects(), touched, { parentOf, skip }) : [];
    const next = new Set(plan.map((p) => p.uid));
    const stale = [...grown].filter((u) => !next.has(u));
    if (stale.length) itemsR.resetRects(rects(), stale);
    const live = itemsR.previewSectionRects(plan.map(({ uid, rect }) => ({ uid, x: rect.x, y: rect.y, w: rect.w, h: rect.h })));
    if (!liveRects) liveRects = new Map();
    for (const [uid, rect] of live) liveRects.set(uid, rect);
    grown = next;
  };

  // ------------------------------------------------------------ controller
  const shortcutSheet = createShortcutSheet({ doc, root, settings: settingsProxy });
  const actions = {
    board,
    rects,
    hitRects: () => paintRects(),
    viewport: () => vp,
    size: () => size,
    setViewport: moveViewport,
    animateViewport,
    fitAll,
    fitSelection,
    onSelection: (sel) => {
      selection = { items: sel.items || [], edge: sel.edge || null, link: sel.link || null };
      dirty.selection = true;
      panel.setSelection(singleItem());
      schedule();
    },
    onTool: (tool, locked) => {
      root.dataset.tool = tool;
      root.setAttribute("data-tool", tool);
      chrome.toolbar.setTool(tool, locked);
    },
    onHover: (uid) => {
      itemsR.setHover(uid);
      pdfHoverUid = typeof uid === "string" ? uid : "";
      syncPdfFlip();
    },
    setGesturing: (on, info) => {
      gesturing = Boolean(on);
      root.classList.toggle("pxd-root--gesturing", gesturing);
      world.style.willChange = gesturing ? "transform" : "";
      if (gesturing) {
        resumeTimer?.();
        resumeTimer = null;
        itemsR.setPaused(true);
        chrome.ctx.hide();
        menu.close();
        try { pdfWarm?.cancelAll?.(); } catch { /* warm */ }
      } else {
        // Only a gesture that actually moved swallows its click; a plain click must reach links and chrome.
        if (info?.moved) {
          suppressClick = true;
          swallowMouseUp = true;
          timers.later(() => { suppressClick = false; swallowMouseUp = false; }, 0);
        }
        liveRects = null;
        resetGrown();
        resumeTimer = timers.later(() => {
          resumeTimer = null;
          itemsR.setPaused(false);
          applyLod();
          propsPanel.place();
          scheduleContent();
          vpStore.set(vpId, vp);
          dirty.selection = true;
          schedule();
          updateBackToContent();
          refreshBadges();
          considerCoverWarm();
          scheduleSharpCovers();
        }, RESUME_MS);
      }
    },
    showMarquee: (rect, kind) => edgesR.setMarquee(rect, kind),
    showLasso: (points) => edgesR.setLasso(points),
    showGuides: (guides) => edgesR.setGuides(guides),
    previewMove: (uids, dx, dy) => {
      const b = board();
      if (!b) return;
      liveRects = itemsR.previewMove(uids, dx, dy, b, rects());
      const set = new Set(uids);
      for (const u of uids) for (const d of descendantsOf(b, u)) set.add(d);
      // A moved item joins the section under its center; that section grows around it (preview only).
      const top = new Set(uids);
      const eff = effectiveRects();
      previewFit(uids, {
        parentOf: (u) => (top.has(u) && eff.get(u) ? containerAt(b, center(eff.get(u)), { exclude: set, rects: eff }) : b.items.get(u)?.parentUid),
      });
      for (const u of grown) set.add(u);
      const links = paintedLinks();
      const linkKeys = new Set(links.filter((l) => set.has(l.from) || set.has(l.to)).map((l) => l.key));
      edgesR.update({ board: b, edgeUids: edgesTouching(b, set), rects: paintRects(), zoom: vp.zoom, linkKeys, links });
      dirty.minimap = true;
      schedule();
    },
    previewRects: (list) => {
      const b = board();
      if (!b) return;
      liveRects = itemsR.previewRects(list);
      if (blockCards.size) scheduleAnchors();
      const set = new Set(list.map((r) => r.uid));
      previewFit(list.map((r) => r.uid), { skip: new Set(list.filter((r) => b.items.get(r.uid)?.type === "section").map((r) => r.uid)) });
      for (const u of grown) set.add(u);
      const links = paintedLinks();
      const linkKeys = new Set(links.filter((l) => set.has(l.from) || set.has(l.to)).map((l) => l.key));
      edgesR.update({ board: b, edgeUids: edgesTouching(b, set), rects: paintRects(), zoom: vp.zoom, linkKeys, links });
      dirty.minimap = true;
      schedule();
    },
    cancelPreview: () => resetGrown(),
    showGhosts: (list) => edgesR.setGhosts(list),
    duplicateItems: (uids, opts) => duplicate(uids, opts),
    openMenu: ({ kind, uid, screen, world }) => {
      const at = screen || { x: 0, y: 0 };
      return openMenuAt(kind, uid, { x: rootRect.left + at.x, y: rootRect.top + at.y }, world || screenToWorld(vp, at));
    },
    foldSelection,
    toggleFocus,
    exitFocus,
    quickLook: () => {
      if (quicklook.isOpen()) { quicklook.close(); return; }
      const uid = lastSelected();
      const it = uid ? board()?.items.get(uid) : null;
      if (it && it.type !== "section") quicklook.open(it);
    },
    closeQuickLook: () => quicklook.close(),
    saveView: () => saveCameraView(),
    closeOverlay: () => {
      if (linksMenu) { closeLinksMenu(); noteOverlayClosed(); return true; }
      if (whyPop) { whyPop.close(); whyPop = null; noteOverlayClosed(); return true; }
      if (contextsDrawer) { contextsDrawer.close(); contextsDrawer = null; noteOverlayClosed(); return true; }
      if (memoryLane) { memoryLane.close(); memoryLane = null; clearLaneMarks(); noteOverlayClosed(); return true; }
      if (viewDialog) {
        closeViewDialog();
        noteOverlayClosed();
        return true;
      }
      if (regionDelete) { closeRegionDelete(); noteOverlayClosed(); return true; }
      if (!laterCtl.isOpen()) return false;
      laterCtl.close();
      noteOverlayClosed();
      return true;
    },
    overlayEscapeRecent: () => Date.now() - lastOverlayClose < 600,
    present: () => startPresent(),
    presentActive: () => presenter.isActive(),
    presentNext: () => presenter.next(),
    presentPrev: () => presenter.prev(),
    exitPresent: () => presenter.stop(),
    expandOutline: (uid) => expandOutline(uid),
    fitHeight: (uid) => fitHeight(uid),
    fitSection: (uid) => session.fitSection?.(uid),
    resetSize: (uids) => session.resetSize?.(uids),
    showTempWire: (spec) => {
      if (!spec) { edgesR.setTempWire(null, rects(), vp.zoom); return; }
      const boxes = rects();
      const box = boxes.get(spec.from);
      let fromPoint;
      if (spec.fromBlock && box) {
        try { fromPoint = wireStart(box, itemsR.measureRow(spec.from, spec.fromBlock), spec.point) || undefined; } catch { fromPoint = undefined; }
      }
      edgesR.setTempWire(fromPoint ? { ...spec, fromPoint } : spec, boxes, vp.zoom);
    },
    blockTarget: (pt) => blockTargetAt(pt),
    clearBlockTarget: () => clearBlockTarget(),
    revealBlockEnd: (edgeUid, end) => revealBlockEnd(edgeUid, end),
    updateEdge: (uid, patch) => session.updateEdge?.(uid, patch),
    commitMove: (uids, dx, dy) => session.commitMove?.(uids, dx, dy),
    commitRects: (list) => session.commitRects?.(list),
    createCard: (p) => { typeAhead.arm(); return Promise.resolve(session.createCard?.({ x: p.x, y: p.y, ...(pendingFor("card") || {}) })).then((uid) => { if (uid) freshItems.add(uid); else typeAhead.cancel(); return uid; }); },
    createTable: (p) => Promise.resolve(session.createTable?.({ x: p.x, y: p.y, w: p.w, h: p.h })).then((uid) => { if (uid) freshItems.add(uid); return uid; }),
    // A task card is a plain TODO block. Plexus writes the marker only; attributes come from Better Tasks.
    rescheduleTasks: (uids, day) => {
      const b = board();
      if (!b || !bt.available()) return;
      const tasks = (uids || []).filter((u) => { const it = b.items.get(u); return it?.type === "card" && it.kind === "note" && isTaskString(it.string); });
      if (!tasks.length) return;
      void Promise.all(tasks.map((u) => bt.modify(u, { attributes: { due: day.iso } }))).then((all) => {
        if (disposed) return;
        const bad = all.find((r) => !r.ok);
        chrome.toast.show({ message: bad ? `Better Tasks could not set the due date: ${bad.reason}` : `Due ${day.title}` });
      });
    },
    createTask: (p) => { typeAhead.arm(); return Promise.resolve(session.createCard?.({ x: p.x, y: p.y, string: "{{[[TODO]]}} " })).then((uid) => { if (uid) { freshItems.add(uid); freshTasks.add(uid); } else typeAhead.cancel(); return uid; }); },
    createText: (p) => {
      typeAhead.arm();
      const spec = { x: p.x, y: p.y };
      if (p.look) spec.look = p.look;
      if (typeof p.w === "number") spec.w = p.w;
      if (typeof p.h === "number") spec.h = p.h;
      if (p.color) spec.color = p.color;
      if (p.shape) spec.shape = p.shape;
      const sticky = pendingFor("sticky");
      if (p.look === "sticky" && sticky?.color) spec.color = sticky.color;
      const shaped = pendingFor("shape");
      if (p.shape && shaped?.shape) spec.shape = shaped.shape;
      // A sticky persists even when it is left empty; only plain text is swept when it ends blank.
      return Promise.resolve(session.createText?.(spec)).then((uid) => { if (uid && p.look !== "sticky") freshItems.add(uid); if (!uid) typeAhead.cancel(); return uid; });
    },
    createSection: (p) => session.createSection?.({ rect: p.rect, ...(pendingFor("section")?.color ? { color: pendingFor("section").color } : {}) }),
    createBoard: (p) => session.createBoard?.({ rect: p.rect }),
    moveIntoBoard: async (uids, boardUid, dx = 0, dy = 0) => {
      const res = await session.moveIntoBoard?.(uids, boardUid);
      if (!res) { void session.commitMove?.(uids, dx, dy); return; }
      chrome.toast.show({ message: `Moved into ${res.title}`, action: { label: "Undo", run: () => res.undo() } });
    },
    openBoard: (uid) => openBoard(uid),
    isBoardCard: (uid) => Boolean(boardTargetOf(uid)),
    popBoard,
    historyBack: () => onHistoryBack?.(),
    historyForward: () => onHistoryForward?.(),
    wrapInSection: (uids) => session.wrapInSection?.(uids),
    deleteItems: (uids, opts) => {
      const lost = cutting ? { count: 0 } : regionsLostBy(uids);
      if (!lost.count) return session.deleteItems?.(uids, opts);
      const noun = lost.count === 1 ? "region" : "regions";
      return new Promise((resolve) => {
        closeRegionDelete();
        regionDelete = openRegionDeleteDialog(doc, {
          message: `This image has ${lost.count} ${noun}. Deleting it breaks every reference to ${lost.count === 1 ? "it" : "them"}. Delete anyway?`,
          onDelete: () => { closeRegionDelete(); resolve(session.deleteItems?.(uids, opts)); },
          onOpen: () => { try { host?.openInSidebar?.(lost.first, "mentions"); } catch { /* sidebar missing */ } },
          onCancel: () => { closeRegionDelete(); resolve(null); },
        });
        root.append(regionDelete.el);
        regionDelete.focus?.();
      });
    },
    deleteEdges: (uids) => session.deleteEdges?.(uids),
    addEdge: (spec) => Promise.resolve(session.addEdge?.(spec)).then((uid) => {
      if (uid && setting("why-prompt", false) === true) openWhy(uid, "why");
      return uid;
    }),
    addRegionEndpoint: (spec) => Promise.resolve(session.addRegionEndpoint?.(spec)).then((uid) => {
      if (uid && setting("why-prompt", false) === true) openWhy(uid, "why");
      return uid;
    }),
    // A fat drag on an image writes a region. A release on an outline reuses it. A thin drag connects to the card.
    regionDrop: ({ from, client, trail } = {}) => {
      if (!client || typeof doc.elementsFromPoint !== "function") return null;
      let card = null;
      let regionUid = null;
      for (const node of doc.elementsFromPoint(client.x, client.y) || []) {
        const itemEl = node.closest?.(".pxd-item");
        if (!itemEl) continue;
        if (itemEl.closest?.(".pxd-root") !== root) return null;
        card = itemEl;
        const mark = node.closest?.("[data-pxd-region]");
        if (mark && itemEl.contains(mark)) regionUid = mark.getAttribute?.("data-pxd-region") || null;
        break;
      }
      if (!card) return null;
      const uid = card.getAttribute?.("data-uid") || card.dataset?.uid;
      if (!uid || uid === from) return null;
      const item = board()?.items.get(uid);
      if (!item) return null;
      const read = (id) => { try { return host?.blockString?.(id); } catch { return null; } };
      const source = item.kind === "image" ? { ok: true } : imageSourceOf(item, read);
      if (!source.ok && !regionUid) return null;
      const media = card.querySelector?.(".pxd-item__media") || card.querySelector?.(".pxd-pdf-cover") || card.querySelector?.("img") || card;
      const box = media.getBoundingClientRect?.();
      if (!box || !(box.width > 0) || !(box.height > 0)) return regionUid ? regionDropPlan({ from, imageUid: uid, regionUid }) : null;
      const rootBox = root.getBoundingClientRect?.() || { left: 0, top: 0 };
      const origin = screenToWorld(vp, { x: (box.left || 0) - (rootBox.left || 0), y: (box.top || 0) - (rootBox.top || 0) });
      const zoom = vp?.zoom || 1;
      const imageRect = { x: origin.x, y: origin.y, w: box.width / zoom, h: box.height / zoom };
      return regionDropPlan({ from, imageUid: uid, regionUid, imageRect, points: trail || [] });
    },
    undo: () => session.undo?.(),
    redo: () => session.redo?.(),
    enterEdit: (uid, opts) => enterEdit(uid, opts),
    openPage: (uid, { sidebar = false } = {}) => {
      const item = board()?.items.get(uid);
      if (item?.kind !== "page") return;
      const pageUid = host?.pageUid?.(item.target?.title || item.title);
      if (!pageUid) return;
      if (sidebar) host?.openInSidebar?.(pageUid, "outline");
      else host?.openPage?.(pageUid);
    },
    exitEdit: () => exitEdit(),
    isEditing: () => itemsR.isEditing(),
    editingUid: () => itemsR.editingUid(),
    autocompleteOpen: () => itemsR.autocompleteOpen(),
    renameSection: (uid) => itemsR.renameSection(uid),
    renamePage: (uid) => itemsR.renamePage(uid),
    editLabel: (uid) => openWhy(uid, setting("why-prompt", false) === true ? "why" : "label"),
    memoryLane: () => toggleMemoryLane(),
    openBlock: (uid) => host?.openBlock?.(uid),
    toast: (t) => chrome.toast.show(t),
    openSearch: () => chrome.search.open(),
    toggleShortcuts: () => shortcutSheet.toggle(),
    openInfo: () => openInfo(),
    addInfoTab: (uid) => {
      const item = board()?.items.get(uid);
      if (item && item.type !== "section") panel.addInfoTab(item);
    },
    cycleLinks,
    isFullscreen: () => isFullscreen,
    setFullscreen: (on) => requestFullscreen(on),
    selectBoardTab: (index) => {
      if (!isFullscreen) return false;
      const tab = tabAt(readTabs(), index);
      if (!tab) return false;
      if (tab.uid === (board()?.uid || boardUid)) return true;
      onSelectTab?.(tab.uid);
      return true;
    },
    setSpace: (on) => root.classList.toggle("pxd-root--space", Boolean(on)),
  };
  // BA-2: highlight the page-card row (or title header) under the pointer while an arrow end is dragged.
  let targetEl = null;
  let targetCls = "";
  const clearBlockTarget = () => {
    if (!targetEl) return;
    targetEl.classList.remove(targetCls);
    targetEl = null;
  };
  const blockTargetAt = (pt) => {
    clearBlockTarget();
    if (!pt || typeof doc.elementsFromPoint !== "function") return null;
    for (const node of doc.elementsFromPoint(pt.x, pt.y) || []) {
      const card = node.closest?.(".pxd-item");
      if (!card) continue;
      if (card.closest?.(".pxd-root") !== root) return null;
      const uid = card.dataset?.uid || card.getAttribute?.("data-uid");
      if (isTableCard(card)) {
        const cell = cellUidOf(node, { pullTree: host?.pullTree });
        targetEl = cell ? cellElementOf(node) : null;
        targetCls = "pxd-row--target";
        targetEl?.classList.add(targetCls);
        return { uid, row: cell, header: false, cell: Boolean(cell) };
      }
      const mark = node.closest?.("[data-pxd-region], [data-pxd-pin]");
      if (mark && card.contains(mark)) {
        const region = mark.getAttribute?.("data-pxd-region") || null;
        const pin = mark.getAttribute?.("data-pxd-pin") || null;
        targetEl = mark;
        targetCls = "pxd-region-hit--hot";
        targetEl.classList.add(targetCls);
        return { uid, row: region || pin, header: false, region: Boolean(region) };
      }
      if (!card.classList.contains("pxd-item--page")) return null;
      const row = node.closest?.("[data-pxd-row]");
      const header = row ? null : node.closest?.(".pxd-item__header");
      targetEl = row || header || null;
      targetCls = row ? "pxd-row--target" : "pxd-item__header--target";
      targetEl?.classList.add(targetCls);
      return { uid, row: row ? row.getAttribute?.("data-pxd-row") || row.dataset?.pxdRow || null : null, header: Boolean(header) };
    }
    return null;
  };
  // BA-3: a clamped marker scrolls the card body to the row and flashes it; a row that is not rendered opens the block.
  const revealBlockEnd = (edgeUid, end) => {
    const e = board()?.edges.get(edgeUid);
    if (!e) return false;
    const card = end === "from" ? e.from : e.to;
    const block = end === "from" ? e.fromBlock : e.toBlock;
    if (!block) return false;
    if (itemsR.revealRow(card, block)) return true;
    host?.openInSidebar?.(block, "block");
    return false;
  };

  const ctl = createInteractions({ actions, settings: settingsProxy });
  ctl.setTool("select");

  // ------------------------------------------------------------ DOM events → controller
  const targetOf = (t) => {
    if (!t || typeof t.closest !== "function") return { kind: "empty" };
    if (t.closest(".pxd-chrome")) return { kind: "chrome" };
    const port = t.closest(".pxd-port");
    if (port) {
      const owner = port.closest(".pxd-item, .pxd-section");
      return { kind: "port", uid: owner?.dataset?.uid || owner?.getAttribute?.("data-uid"), side: port.dataset?.side || port.getAttribute?.("data-side") };
    }
    const grip = t.closest(".pxd-grip");
    if (grip) {
      const owner = grip.closest(".pxd-item, .pxd-section");
      return { kind: "grip", uid: owner?.dataset?.uid || owner?.getAttribute?.("data-uid"), part: grip.dataset?.part || grip.getAttribute?.("data-part") };
    }
    const endHandle = t.closest(".pxd-edge__end");
    if (endHandle) return { kind: "edge-end", uid: endHandle.closest(".pxd-edge")?.dataset?.uid || endHandle.closest(".pxd-edge")?.getAttribute?.("data-uid"), end: endHandle.dataset?.end || endHandle.getAttribute?.("data-end") };
    const clamped = t.closest(".pxd-edge__bend--clamped");
    if (clamped) return { kind: "edge-marker", uid: clamped.closest(".pxd-edge")?.dataset?.uid || clamped.closest(".pxd-edge")?.getAttribute?.("data-uid"), end: clamped.dataset?.end || clamped.getAttribute?.("data-end") };
    const label = t.closest(".pxd-label");
    if (label) {
      const key = label.dataset?.key || label.getAttribute?.("data-key");
      if (key) return { kind: "link", key };
      return { kind: "label", uid: label.dataset?.uid || label.getAttribute?.("data-uid") };
    }
    const edge = t.closest(".pxd-edge");
    if (edge) return { kind: "edge", uid: edge.dataset?.uid || edge.getAttribute?.("data-uid") };
    const link = t.closest(".pxd-link");
    if (link) return { kind: "link", key: link.dataset?.key || link.getAttribute?.("data-key") };
    const title = t.closest(".pxd-section__title");
    if (title) return { kind: "section-title", uid: title.closest(".pxd-section")?.dataset?.uid || title.closest(".pxd-section")?.getAttribute?.("data-uid") };
    const border = t.closest(".pxd-section__edge");
    if (border) return { kind: "section-border", uid: border.closest(".pxd-section")?.dataset?.uid || border.closest(".pxd-section")?.getAttribute?.("data-uid") };
    const item = t.closest(".pxd-item");
    if (item) {
      const hit = { kind: "item", uid: item.dataset?.uid || item.getAttribute?.("data-uid"), part: t.closest(".pxd-item__header") ? "header" : "body" };
      const mark = t.closest("[data-pxd-region], [data-pxd-pin]");
      if (mark && item.contains(mark)) {
        hit.row = mark.getAttribute?.("data-pxd-region") || mark.getAttribute?.("data-pxd-pin") || "";
        return hit;
      }
      // PG-3: the page-card row under the pointer (not for a link, checkbox or image inside it).
      const native = nativeClickKind(t);
      const row = native ? null : t.closest("[data-pxd-row]");
      if (row) hit.row = row.getAttribute?.("data-pxd-row") || row.dataset?.pxdRow || "";
      else if (!native && isTableCard(item)) {
        const cell = cellUidOf(t, { pullTree: host?.pullTree });
        if (cell) hit.row = cell;
      }
      return hit;
    }
    return { kind: "empty" };
  };
  // Pan, marquee and card drag never use a handle. Only an edge-end drag, a connect, or a press that
  // might start one looks at handle centres, and it uses the world points stored at render.
  const END_GESTURE = new Set(["edge-end", "connect"]);
  const NO_END_GESTURE = new Set(["pan", "marquee", "move", "lasso", "resize", "place", "section-draw", "board-draw"]);
  const edgeEndWanted = (type, event) => {
    const kind = ctl.gestureKind();
    if (NO_END_GESTURE.has(kind)) return false;
    if (END_GESTURE.has(kind)) return true;
    if (type !== "pointerdown" && type !== "dblclick" && type !== "contextmenu") return false;
    if (event.button === 1) return false;
    return true;
  };
  const handleCenters = () => {
    const uid = selection.edge;
    const geo = uid ? edgesR.geometryOf?.(uid) : null;
    if (!geo?.start || !geo?.end) return null;
    return [
      { uid, end: "from", x: geo.start.x, y: geo.start.y },
      { uid, end: "to", x: geo.end.x, y: geo.end.y },
    ];
  };
  const normalize = (event, type = event.type) => {
    const screen = { x: (event.clientX || 0) - rootRect.left, y: (event.clientY || 0) - rootRect.top };
    const world = screenToWorld(vp, screen);
    let target = targetOf(event.target);
    if (edgeEndWanted(type, event)) {
      const near = edgeEndNearWorld(handleCenters(), world, 10, vp.zoom || 1);
      if (near) target = near;
    }
    return {
      type,
      screen,
      client: { x: event.clientX || 0, y: event.clientY || 0 },
      world,
      target,
      button: event.button ?? 0,
      buttons: event.buttons ?? 0,
      shift: Boolean(event.shiftKey),
      alt: Boolean(event.altKey),
      meta: Boolean(event.metaKey),
      ctrl: Boolean(event.ctrlKey),
      key: event.key,
      code: event.code,
      deltaX: event.deltaX || 0,
      deltaY: event.deltaY || 0,
      pointerId: event.pointerId,
      isPrimary: event.isPrimary,
      pointerType: event.pointerType,
    };
  };

  // Speed log only. Event Timing for a click inside .pxd-root, and pan fps from the gesture's rAF deltas.
  const armSpeedLog = () => {
    if (!flag("speed-log", false) || !perfLog?.armEvent) return;
    perfLog.armEvent(lifecycle);
  };
  armSpeedLog();
  let captured = false;
  // Touch and pen only. A mouse still uses the contextmenu event. No setPointerCapture.
  let pressWatch = null;
  const touchIds = new Set();
  const clearPressWatch = () => {
    pressWatch?.cancel?.();
    pressWatch = null;
  };
  const notePressMove = (event) => {
    if (!pressWatch) return;
    if (pressWatch.pointerId != null && event.pointerId != null && event.pointerId !== pressWatch.pointerId) return;
    const dist = Math.hypot((event.clientX || 0) - pressWatch.x, (event.clientY || 0) - pressWatch.y);
    if (dist > pressWatch.moved) pressWatch.moved = dist;
    if (pressWatch.moved >= LONG_PRESS_CANCEL_PX) clearPressWatch();
  };
  const endPress = (event) => {
    if (event?.pointerId != null) touchIds.delete(event.pointerId);
    else touchIds.clear();
    if (!pressWatch) return;
    if (pressWatch.pointerId == null || event?.pointerId == null || event.pointerId === pressWatch.pointerId) clearPressWatch();
  };
  const armLongPress = (event) => {
    const kind = event.pointerType;
    if (kind !== "touch" && kind !== "pen") return;
    if ((event.button ?? 0) !== 0) return;
    if (leavesBoardPointer(event.target)) return;
    // A primary pointer starts a new touch sequence; ids whose pointerup never reached us are stale.
    if (event.isPrimary === true) touchIds.clear();
    if (event.pointerId != null) touchIds.add(event.pointerId);
    if (touchIds.size >= 2) {
      clearPressWatch();
      return;
    }
    clearPressWatch();
    const watch = {
      x: event.clientX || 0,
      y: event.clientY || 0,
      moved: 0,
      pointerId: event.pointerId,
      target: event.target,
      cancel: null,
    };
    watch.cancel = timers.later(() => {
      if (pressWatch !== watch || disposed) return;
      const moved = watch.moved;
      pressWatch = null;
      if (longPressAt(moved, LONG_PRESS_MS) !== "open") return;
      ctl.cancel();
      onRootContextMenu({
        type: "contextmenu",
        target: watch.target,
        clientX: watch.x,
        clientY: watch.y,
        button: 2,
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() {},
      });
    }, LONG_PRESS_MS);
    pressWatch = watch;
  };
  const onDocMove = (event) => {
    notePressMove(event);
    if (suspended || !ctl.isGesturing()) return;
    ctl.handle(normalize(event, "pointermove"));
  };
  const onDocUp = (event) => {
    endPress(event);
    if (suspended) return;
    if (!ctl.isGesturing()) return releaseCapture();
    const panning = ctl.gestureKind() === "pan";
    ctl.handle(normalize(event, "pointerup"));
    if (panning && flag("speed-log", false)) perfLog?.endPan?.();
    // preventDefault on pointerdown suppresses the click, so a stationary ref opens here.
    // A drag sets suppressClick before this line and must not navigate.
    if (nativeClickKind(event.target) === "ref" && !suppressClick) openRefFromClick(event);
    releaseCapture();
  };
  const onDocCancel = (event) => {
    endPress(event);
    if (suspended) return;
    const panning = ctl.gestureKind() === "pan";
    ctl.handle({ type: "pointercancel" });
    if (panning && flag("speed-log", false)) perfLog?.endPan?.();
    releaseCapture();
  };
  const releaseCapture = () => {
    if (!captured) return;
    captured = false;
    doc.removeEventListener("pointermove", onDocMove, true);
    doc.removeEventListener("pointerup", onDocUp, true);
    doc.removeEventListener("pointercancel", onDocCancel, true);
  };
  // Completing a repeating task makes Better Tasks write the next occurrence on a daily or project page, not on
  // the board. Look for it after the click and offer to add it.
  const watchRecurrence = (uid) => {
    const item = uid ? board()?.items?.get(uid) : null;
    const meta = item && isTaskString(item.string) ? taskMeta(item.string, item.content) : null;
    if (!meta || meta.done || !meta.repeat || !bt.available()) return;
    const query = plainText(item.string, 80);
    const look = (attempt) => {
      if (disposed) return;
      void bt.search({ query, status: "TODO", max_results: 10 }).then((tasks) => {
        if (disposed) return;
        const next = tasks.find((t) => t.uid !== uid && !board()?.items?.has(t.uid) && t.attributes?.repeat);
        if (next) {
          const due = String(next.due || "").replace(/^\[\[|\]\]$/g, "");
          chrome.toast.show({ message: `Next occurrence${due ? ` on ${due}` : ""}`, action: { label: "Add to board", run: () => { void session.addBlockRef?.(next.uid); } } });
        } else if (attempt < 3) timers.later(() => look(attempt + 1), 2000);
      });
    };
    timers.later(() => look(1), 1500);
  };
  const flipMarker = (uid) => {
    const next = toggleTodoAt(board()?.items?.get(uid)?.string, 0);
    if (next != null) session.setString?.(uid, next);
  };
  const completeLightCheck = async (uid, box) => {
    if (readSetting("better-tasks") !== true) return;
    const item = board()?.items?.get(uid);
    if (!item || !isTaskString(item.string)) return;
    const wasDone = taskState(item.string) === "DONE";
    box.classList?.toggle("pxd-task-check--done", !wasDone);
    box.setAttribute?.("aria-checked", wasDone ? "false" : "true");
    if (wasDone) {
      const res = bt.available() ? await bt.modify(uid, { status: "TODO" }) : { ok: false };
      if (!res.ok && !disposed) flipMarker(uid);
      return;
    }
    watchRecurrence(uid);
    const res = await taskDone.complete(uid);
    if (res.ok || disposed) return;
    const via = await bt.modify(uid, { status: "DONE" });
    if (!via.ok && !disposed) flipMarker(uid);
  };
  const toggleClickedTodo = (node) => {
    // RE-5: a task card's checkbox is a light span. Done goes through Better Tasks' own checkbox path (RE-1) so the
    // Completed date and the next occurrence happen; un-doing goes through bt_modify. Either falls back to the marker.
    const light = node?.closest?.(".pxd-task-check");
    if (light) {
      const uid = light.closest?.(".pxd-item")?.getAttribute?.("data-uid");
      if (uid) void completeLightCheck(uid, light);
      return;
    }
    const card = node?.closest?.(".pxd-item");
    const uid = card?.getAttribute?.("data-uid") || card?.dataset?.uid;
    if (!uid) return;
    const stringRoot = node.closest?.(".pxd-item__string") || card;
    const boxes = [...stringRoot.querySelectorAll('input[type="checkbox"]')];
    const hit = node.closest?.("input, label, .check-container");
    const input = String(hit?.tagName || "").toLowerCase() === "input" ? hit : hit?.querySelector?.('input[type="checkbox"]');
    const index = input ? boxes.indexOf(input) : 0;
    const next = toggleTodoAt(board()?.items?.get(uid)?.string, index < 0 ? 0 : index);
    if (next == null) return;
    session.setString?.(uid, next);
  };
  let tablePointer = null;
  const inRoamTable = (node) => {
    const hostNode = tablePointerTarget(node);
    return Boolean(hostNode && root.contains(hostNode));
  };
  let onBoardPointerDown;
  listen(root, "pointerdown", onBoardPointerDown = (event) => {
    if (leavesBoardPointer(event.target)) return;
    if (inRoamTable(event.target) && !event.__pxdGrab) { tablePointer = event.target; return; }
    // Interact is on: this click belongs to the reader. preventDefault or stopPropagation would block page nav.
    if (pdfClickShield(event.target)) return;
    else if (root.querySelector?.(".pxd-pdf-live")) itemsR.endPdfInteract();
    // The linked-references drawer drags a mention out. preventDefault would cancel that drag and move the card.
    if (event.target?.closest?.(".pxd-refs")) {
      event.stopPropagation();
      return;
    }
    // A rendered checkbox is not a Roam block control. Flip that TODO and leave the card alone.
    if (nativeClickKind(event.target) === "checkbox") { toggleClickedTodo(event.target); return; }
    measure();
    const ev = normalize(event, "pointerdown");
    const editingUid = itemsR.editingUid();
    const native = nativeClickKind(event.target);
    // Keep Roam's block handlers out of the overlay. Cancelling pointerdown also suppresses the compat
    // mousedown that Roam's page refs navigate on, so a drag that starts on a [[link]] moves the card.
    // An image must keep its click so Roam can open the viewer. A ref is opened from pointerup.
    if (!(editingUid && ev.target.kind === "item" && ev.target.uid === editingUid && ev.target.part !== "header")) {
      event.stopPropagation();
      if (native !== "image" && ev.target.kind !== "label" && ev.target.kind !== "section-title") event.preventDefault();
    }
    ctl.handle(ev);
    if (flag("speed-log", false) && ctl.gestureKind() === "pan") perfLog?.beginPan?.();
    if (ctl.isGesturing() && !captured) {
      captured = true;
      doc.addEventListener("pointermove", onDocMove, true);
      doc.addEventListener("pointerup", onDocUp, true);
      doc.addEventListener("pointercancel", onDocCancel, true);
      // No setPointerCapture: capture retargets click/dblclick to the root, which made double-click on a card
      // create a phantom card and swallowed [[link]] clicks. Document-level listeners already follow the drag.
    }
    try { if (!editingUid && ev.target.kind !== "label") root.focus({ preventScroll: true }); } catch { /* stub */ }
    armLongPress(event);
  });
  // Capture runs before a grid cell or a live sticky body can stop the bubble. A move past the
  // threshold hands the original press to the board; a click that stays put is left to the cell.
  const GRAB_SKIP = ".pxd-port, .pxd-grip, .pxd-chrome, .rg-col-resize, .rg-row-resize, .pxd-roam-table__open, .pxd-table-overlay, .pxd-refs";
  let grab = null;
  const grabOffs = [];
  const clearGrab = () => {
    while (grabOffs.length) {
      try { grabOffs.pop()(); } catch { /* already off */ }
    }
    grab = null;
  };
  const fieldTarget = (node) => {
    const tag = String(node?.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if (node?.isContentEditable) return true;
    const ce = node?.getAttribute?.("contenteditable");
    return ce === "" || ce === "true";
  };
  const onGrabMove = (event) => {
    if (!grab) return;
    if (grab.id != null && event.pointerId != null && event.pointerId !== grab.id) return;
    const dx = (Number(event.clientX) || 0) - grab.x;
    const dy = (Number(event.clientY) || 0) - grab.y;
    if (Math.hypot(dx, dy) < 4) return;
    if (ctl.isGesturing()) { clearGrab(); return; }
    const down = grab.down;
    clearGrab();
    down.__pxdGrab = true;
    onBoardPointerDown(down);
    onDocMove(event);
  };
  const onGrabEnd = (event) => {
    if (!grab) return;
    if (grab.id != null && event.pointerId != null && event.pointerId !== grab.id) return;
    clearGrab();
  };
  listen(root, "pointerdown", (event) => {
    if ((event.button ?? 0) !== 0) return;
    if (leavesBoardPointer(event.target)) return;
    const item = event.target?.closest?.(".pxd-item");
    if (!item || !root.contains(item)) return;
    const uid = item.getAttribute?.("data-uid") || item.dataset?.uid;
    if (!uid || itemsR.editingUid?.() === uid) return;
    if (event.target?.closest?.(GRAB_SKIP)) return;
    // Connect from a cell, row, region, or pin starts immediately. A card move still waits for 4px.
    if (ctl.getTool() === "connect") {
      const endUid = endpointUnderPointer(event.target, (node) => {
        const card = node?.closest?.(".pxd-item");
        if (!card || !isTableCard(card)) return null;
        return cellUidOf(node, { pullTree: host?.pullTree });
      });
      if (endUid) {
        event.__pxdGrab = true;
        onBoardPointerDown(event);
        return;
      }
    }
    if (nativeClickKind(event.target)) return;
    const stickyBody = Boolean(item.classList?.contains("pxd-item--sticky") && event.target?.closest?.(".pxd-item__body"));
    if (!stickyBody && fieldTarget(event.target)) return;
    if (!stickyBody && !inRoamTable(event.target) && !event.target?.closest?.(".pxd-item__body, .pxd-item__header")) return;
    if (grab) clearGrab();
    grab = { id: event.pointerId, x: Number(event.clientX) || 0, y: Number(event.clientY) || 0, down: event };
    grabOffs.push(listen(doc, "pointermove", onGrabMove, true));
    grabOffs.push(listen(doc, "pointerup", onGrabEnd, true));
    grabOffs.push(listen(doc, "pointercancel", onGrabEnd, true));
  }, true);
  // The mouseup that ends a drag must not reach a [[link]] the pointer happens to be over (it moved with the card).
  listen(doc, "mouseup", (event) => {
    if (!swallowMouseUp) return;
    swallowMouseUp = false;
    event.stopImmediatePropagation();
    event.preventDefault();
  }, true);
  // mousedown/mouseup: inner React roots (renderString links) see them first; Roam's block handlers do not.
  for (const type of ["mousedown", "mouseup"]) {
    listen(root, type, (event) => {
      if (leavesBoardPointer(event.target) || inRoamTable(event.target)) return;
      const native = nativeClickKind(event.target);
      if (native === "checkbox" || native === "image") return;
      const editing = itemsR.editingUid();
      if (editing && event.target?.closest?.(".pxd-item--editing")) return;
      event.stopPropagation();
    });
  }
  listen(root, "dragstart", (event) => {
    if (leavesBoardPointer(event.target) || inRoamTable(event.target) || event.target?.closest?.(".pxd-item--editing, .pxd-refs__row")) return;
    event.preventDefault();
  });
  // Capture phase only cancels the click that ends a drag. Shielding Roam's block-edit handlers happens in
  // the bubble phase, after renderString's own React roots inside cards have handled [[link]] clicks.
  listen(root, "click", (event) => {
    if (suppressClick) { event.stopPropagation(); event.preventDefault(); return; }
    if (inRoamTable(event.target)) return;
    // Roam's page-ref handlers stop click propagation inside the card's React root, so links are routed here,
    // in the capture phase, before the target sees the click.
    if (openRefFromClick(event)) { event.stopPropagation(); event.preventDefault(); }
  }, true);
  // Static card content: [[page]] / #tag / attr refs carry data-link-uid, ((block)) refs .rm-block-ref[data-uid].
  // Click opens them (Shift: right sidebar), matching Roam; editing cards keep Roam's own handling.
  // pointerup and the click that follows are one gesture, so the second call is a no-op.
  let lastRefKey = "";
  let lastRefAt = 0;
  const openRefFromClick = (event) => {
    const t = event.target;
    if (!t?.closest || !t.closest(".pxd-item") || t.closest(".pxd-item--editing")) return false;
    const api = host?.api;
    const page = t.closest("[data-link-uid]");
    const block = t.closest(".rm-block-ref[data-uid]");
    const uid = page?.getAttribute("data-link-uid") || block?.getAttribute("data-uid");
    if (!uid || !api?.ui) return false;
    const key = `${uid}:${event.shiftKey ? 1 : 0}`;
    const now = Date.now();
    if (key === lastRefKey && now - lastRefAt < 500) return true;
    lastRefKey = key;
    lastRefAt = now;
    if (event.shiftKey) api.ui.rightSidebar?.addWindow?.({ window: { type: page ? "outline" : "block", "block-uid": uid } });
    else if (page) api.ui.mainWindow?.openPage?.({ page: { uid } });
    else api.ui.mainWindow?.openBlock?.({ block: { uid } });
    return true;
  };
  listen(root, "click", (event) => {
    const kind = nativeClickKind(event.target);
    if (kind === "image" || kind === "checkbox") return;
    if (inRoamTable(event.target)) return;
    if (!leavesBoardPointer(event.target)) event.stopPropagation();
  });
  listen(root, "dblclick", (event) => {
    if (leavesBoardPointer(event.target) || inRoamTable(event.target) || event.target?.closest?.(".pxd-refs")) return;
    if (nativeClickKind(event.target)) return;
    event.stopPropagation();
    event.preventDefault();
    measure();
    ctl.handle(normalize(event, "dblclick"));
  });
  listen(root, "wheel", (event) => {
    if (leavesBoardPointer(event.target)) return;
    if (inRoamTable(event.target)) { event.stopPropagation(); return; }
    // PG-1: a plain wheel scrolls a long page card's body until it hits an end; Cmd/Ctrl+wheel still zooms.
    if (pageBodyWantsWheel(event.target, event)) { event.stopPropagation(); return; }
    measure(); // the outer Roam page scrolls without any pointer event on the board
    const handled = ctl.handle(normalize(event, "wheel"));
    if (handled) { event.preventDefault(); event.stopPropagation(); settle(); }
  }, { passive: false });
  // Right-click: the controller decides what was hit and asks us to open the menu; an editing card keeps the
  // browser's own menu (the controller returns false there). A long-press calls this same function.
  const onRootContextMenu = (event) => {
    if (leavesBoardPointer(event.target) || inRoamTable(event.target)) return;
    event.stopPropagation?.();
    // Roam's own menu for a ref / tag already handled this (its React root ran first); links and images keep the browser's.
    if (event.defaultPrevented) return;
    const native = event.target?.closest?.(NATIVE_MENU_TARGETS);
    if (native && native.closest?.(".pxd-item__body")) return;
    measure();
    const handled = ctl.handle(normalize(event, "contextmenu"));
    if (handled) event.preventDefault?.();
  };
  listen(root, "contextmenu", onRootContextMenu);
  const hoverCardAt = (uid) => {
    const it = uid ? board()?.items.get(uid) : null;
    return it && it.type === "card" ? it : null;
  };
  const openHover = (it) => {
    hoverUid = it.uid;
    const anchor = () => {
      const r = rects().get(it.uid);
      return r ? { kind: "items", rect: toScreenRect(r) } : null;
    };
    chrome.ctx.show(it.kind === "board" ? "board" : "card", cardModel(it), anchor);
  };
  const showHover = (uid) => {
    if (gesturing || itemsR.isEditing()) { cancelHoverGrace(); hoverUid = null; return; }
    if (selectionOwnsBar()) { cancelHoverGrace(); hoverUid = null; return; }
    const it = hoverCardAt(uid);
    if (hoverUid && chrome.ctx.isOpen()) {
      // Back on the card whose bar is up: the grace is void.
      if (it && it.uid === hoverUid) { cancelHoverGrace(); return; }
      // Onto another card: switch at once (no wait, no hide/show flicker).
      if (it) { cancelHoverGrace(); openHover(it); return; }
      // Off every card onto empty canvas: keep the bar for the grace, so the pointer can reach it.
      if (hoverPending) return;
      const pending = { cancel: null };
      pending.cancel = timers.later(() => {
        hoverPending = null;
        if (disposed || gesturing || itemsR.isEditing() || selectionOwnsBar()) { hoverUid = null; return; }
        hideHover();
      }, HOVER_GRACE);
      hoverPending = pending;
      return;
    }
    cancelHoverGrace();
    if (!it) { if (hoverUid) { hoverUid = null; chrome.ctx.hide(); } return; }
    openHover(it);
  };
  listen(root, "pointermove", (event) => {
    tablePointer = inRoamTable(event.target) ? event.target : null;
    lastPointer = { x: event.clientX || 0, y: event.clientY || 0 };
    const pdfNode = event.target?.closest?.(".pxd-item--pdf");
    const pdfUnder = pdfNode?.getAttribute?.("data-uid") || "";
    if (pdfUnder !== liftHoverUid) { liftHoverUid = pdfUnder; scheduleLift(); }
    if (event.target?.closest?.(".pxd-chrome")) {
      // The bar, its bridge and its popovers count as the card: hovering them keeps the toolbar.
      if (hoverPending && event.target.closest(".pxd-ctx")) cancelHoverGrace();
      return;
    }
    const node = event.target?.closest?.(".pxd-item--card");
    showHover(node?.getAttribute?.("data-uid") || node?.dataset?.uid || null);
  });
  // The root is a clipped box, never a scroller: focus, scrollIntoView and Roam's reader can still move it, which slides the pane header under Roam's top bar.
  const pinScroll = (node) => () => {
    if (node && (node.scrollTop || node.scrollLeft)) { node.scrollTop = 0; node.scrollLeft = 0; }
  };
  listen(root, "scroll", pinScroll(root));
  if (mountEl) listen(mountEl, "scroll", () => { if (isFullscreen) pinScroll(mountEl)(); });
  listen(root, "pointerenter", () => { pointerInside = true; pointerBoard = root; });
  listen(root, "pointerleave", () => { tablePointer = null; pointerInside = false; if (pointerBoard === root) pointerBoard = null; });
  const closeHighlightDialog = () => {
    const node = highlightDialog;
    highlightDialog = null;
    if (node && typeof node.close === "function") node.close();
    else node?.remove?.();
  };
  const dateBlockForDrop = (dropString) => {
    const text = String(dropString ?? "").trim();
    const match = BLOCK_REF.exec(text);
    if (!match) return null;
    const uid = match[1];
    let string = null;
    try { string = host?.blockString?.(uid); } catch { string = null; }
    if (typeof string !== "string" || !isDateBlockString(string)) return null;
    let children = [];
    try {
      const tree = host?.pdfHighlightTree?.(uid);
      children = Array.isArray(tree) ? tree : [];
    } catch { children = []; }
    return { uid, string, children };
  };
  const pdfSourceOf = (item) => {
    if (item?.target?.kind === "block") {
      try { return host?.blockString?.(item.target.uid) || ""; } catch { return ""; }
    }
    return typeof item?.string === "string" ? item.string : "";
  };
  const openHighlightPicker = (item, anchor) => {
    if (disposed || item?.kind !== "pdf") return;
    closeHighlightDialog();
    let pageUid = null;
    try { pageUid = host?.pdfCover?.(pdfSourceOf(item))?.pageUid || null; } catch { pageUid = null; }
    let tree = [];
    try {
      const pulled = pageUid ? host?.pdfHighlightTree?.(pageUid) : [];
      tree = Array.isArray(pulled) ? pulled : [];
    } catch { tree = []; }
    const placed = [...(board()?.items.values() || [])];
    const rows = highlightRows(tree, { placed });
    const live = rects().get(item.uid);
    const origin = {
      x: (live?.x ?? item.x ?? 0) + (live?.w ?? item.w ?? 0) + 40,
      y: live?.y ?? item.y ?? 0,
    };
    const node = openHighlightDialog(doc, {
      rows,
      origin,
      onPlace: (items, { omitted = 0 } = {}) => {
        if (!items?.length) return;
        if (omitted > 0) toast(`Placed ${items.length}. ${omitted} left: run Add highlights again.`);
        const made = session.addRefCards?.(items);
        Promise.resolve(made).then((uids) => {
          if (!disposed && Array.isArray(uids) && uids.length) ctl.select(uids);
        }).catch(() => {});
      },
      onClose: () => { highlightDialog = null; },
    });
    highlightDialog = node;
    root.append(node);
    if (anchor?.getBoundingClientRect) {
      placeNearAnchor(node, anchor.getBoundingClientRect(), root, { gap: 6 });
    }
  };
  // Header text is replaced when the card body mounts, so the button stays on the card.
  // `changed` is the set of item uids this sync touched (null: all). The highlight count is a graph read, so a
  // button that is already there is refreshed only when its card changed.
  const refreshPdfHighlightCounts = () => {
    const b = board();
    if (!b) return;
    for (const item of b.items.values()) {
      if (item?.kind !== "pdf") continue;
      const have = itemsR.shellOf?.(item.uid)?.querySelector?.(".pxd-pdf-highlights");
      if (!have) continue;
      let count = 0;
      try { count = Number(host?.pdfCover?.(pdfSourceOf(item))?.count) || 0; } catch { count = 0; }
      setHighlightCount(have, count);
    }
  };
  const ensurePdfHighlightButtons = (changed = null) => {
    if (disposed) return;
    const b = board();
    if (!b) return;
    for (const item of b.items.values()) {
      if (item?.kind !== "pdf") continue;
      const shell = itemsR.shellOf?.(item.uid);
      if (!shell) continue;
      const have = shell.querySelector?.(".pxd-pdf-highlights");
      if (have && changed && !changed.has(item.uid)) continue;
      let count = 0;
      try { count = Number(host?.pdfCover?.(pdfSourceOf(item))?.count) || 0; } catch { count = 0; }
      if (have) { setHighlightCount(have, count); continue; }
      const btn = pdfHighlightButton(doc, () => openHighlightPicker(item, btn), count);
      btn.classList.add("pxd-hl-add");
      shell.append(btn);
    }
  };
  const dropEffectFor = (effectAllowed) => {
    const a = String(effectAllowed || "uninitialized");
    if (a === "all" || a === "uninitialized" || /copy/i.test(a)) return "copy";
    if (/move/i.test(a)) return "move";
    if (/link/i.test(a)) return "link";
    return "copy";
  };
  const onDragAccept = (event) => {
    const editor = event.target?.closest?.(".pxd-item__editor");
    if (editor) {
      if (!dragHasImages(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = dropEffectFor(event.dataTransfer.effectAllowed);
  };
  listen(root, "dragenter", onDragAccept);
  listen(root, "dragover", onDragAccept);
  listen(root, "drop", (event) => {
    const editor = event.target?.closest?.(".pxd-item__editor");
    if (editor) {
      const files = filesFromDataTransfer(event.dataTransfer);
      if (!files.length) return;
      event.preventDefault();
      event.stopPropagation();
      const ta = editorTextarea(event.target) || editorTextarea(editor);
      const cardUid = itemsR.editingUid?.();
      const role = inputBlockRole(ta || event.target, cardUid);
      void pasteEditorImages(ta, role.uid || cardUid, files);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.target?.closest?.(".pxd-read")) return;
    measure();
    const p = screenToWorld(vp, { x: event.clientX - rootRect.left, y: event.clientY - rootRect.top });
    const files = filesFromDataTransfer(event.dataTransfer);
    if (files.length) { void pasteImages(files, p); return; }
    const resolveUid = (u) => (host?.cardStringForUid ? host.cardStringForUid(u) : `((${u}))`);
    const list = parseDropPayload(event.dataTransfer, { resolveUid, graph: host?.graph || "" });
    if (!list.length) return;
    if (list.every((row) => row.office)) {
      list.forEach((row, index) => runOffice(row.office, { x: p.x, y: p.y + index * 184 }));
      return;
    }
    if (list.length === 1 && list[0].parse) {
      const payload = { ...list[0].parse, withSource: gestureSource(readWithSource(storage), Boolean(event.altKey)) };
      void handleParseDrop({
        payload,
        store: createParseStore({ indexedDB: doc.defaultView?.indexedDB }),
        session,
        point: p,
        toast: (message) => toast(message),
        upload: (file) => host.uploadFile?.(file),
      }).then((res) => {
        if (disposed) return;
        if (Array.isArray(res?.uids) && res.uids.length) {
          ctl.select(res.uids);
          revealParsed(res.uids);
          focusBoardAfterInsert();
        }
      }).catch(() => {});
      return;
    }
    const dropped = highlightDropPlan(list, [...(board()?.items.values() || [])]);
    if (dropped.kind === "pulse") {
      if (dropped.uid) pulseItem(dropped.uid);
      return;
    }
    const w = Number(setting("default-card-width", DEFAULT_SIZES.card.w)) || DEFAULT_SIZES.card.w;
    const h = Number(setting("default-card-height", DEFAULT_SIZES.card.h)) || DEFAULT_SIZES.card.h;
    // A [[page]] drop stays a page card. A ((uid)) whose block is a date expands only after confirm.
    const planned = planDroppedCards(list, {
      blockOf: dateBlockForDrop,
      confirm: (message) => {
        const ask = win?.confirm;
        if (typeof ask !== "function") return false;
        try { return ask(message) === true; } catch { return false; }
      },
      card: { w, h },
      page: PAGE_CARD,
      at: p,
    });
    if (!planned) return;
    if (droppedDrawingUids(planned.map((x) => x.string), (id) => host?.blockString?.(id)).length) toast(DRAWING_DROP_TOAST);
    const fromReader = Boolean(doc.activeElement?.closest?.(".pxd-read"));
    const made = session.addRefCards?.(planned);
    const same = planned.length === list.length && planned.every((row, i) => row.string === list[i].string);
    const offer = same ? dropNamespace(list.map((x) => x.string)) : null;
    Promise.resolve(made).then((uids) => {
      if (Array.isArray(uids) && uids.length) {
        ctl.select(uids);
        if (fromReader) focusBoardAfterInsert();
      }
      if (!offer || !Array.isArray(uids) || disposed) return;
      const mine = offer.indexes.map((i) => uids[i]).filter(Boolean);
      if (!mine.length) return;
      chrome.toast.show({
        message: `Group under ${offer.parent}`,
        action: { label: `Group under ${offer.parent}`, run: () => { void session.groupUnder?.(mine, offer.parent); } },
      });
    }).catch(() => {});
  });

  const openFocusedCardMenu = (hostEl) => {
    const uid = hostEl.dataset?.uid || hostEl.getAttribute?.("data-uid");
    const item = uid ? board()?.items.get(uid) : null;
    if (!item) return false;
    const kind = item.type === "section" ? "section" : item.type === "text" ? "text" : "card";
    const rect = hostEl.getBoundingClientRect();
    const box = root.getBoundingClientRect();
    const screen = { x: (rect.left || 0) - (box.left || 0), y: (rect.bottom || 0) - (box.top || 0) };
    const ok = openMenuAt(kind, uid, { x: rect.left || 0, y: rect.bottom || 0 }, screenToWorld(vp, screen));
    if (ok) menu.focusFirst?.();
    return ok;
  };
  const ownsKeyboard = () => {
    const active = doc.activeElement;
    const activeRoot = active?.closest?.(".pxd-root");
    if (activeRoot) return activeRoot === root;
    if (pointerBoard) return pointerBoard === root;
    return isFullscreen;
  };
  let outsideQuiet = null;
  let swallowEnterUp = false;
  const onKeyDown = (event) => {
    if (typeAhead.take(event)) return;
    // True when this Escape is the reader's, and the side effect has already run. Native fullscreen
    // returns true without preventDefault so the browser can leave fullscreen and the card stays up.
    const consumePdfEscape = () => {
      if (event.key !== "Escape") return false;
      const liveNode = root.querySelector?.(".pxd-pdf-live");
      const fsEl = doc.fullscreenElement;
      const action = pdfEscapeAction({
        // Card edit, Quick Look, and a presentation keep Escape. Native fullscreen still wins.
        live: Boolean(liveNode) && !itemsR.isEditing() && !quicklook.isOpen() && !presenter.isActive(),
        fullscreen: Boolean(fsEl && (liveNode || fsEl.closest?.(".pxd-pdf-live, .rm-pdf-container") || fsEl.querySelector?.(".rm-pdf-container"))),
      });
      if (action === "end-interact") {
        event.preventDefault();
        event.stopPropagation();
        itemsR.endPdfInteract();
        return true;
      }
      if (action === "native") return true;
      return false;
    };
    if (event.target?.closest?.(".pxd-read")) return;
    // The arrow label lives on document.body. It is outside the board, but it is not a Roam edit.
    if (event.target?.closest?.(".pxd-why")) return;
    // A keystroke outside the board is a Roam transaction. Drop live card renders first,
    // before any board lookup, and put them back shortly after typing stops.
    if (isTextEntryTarget(event.target) && !root.contains?.(event.target)) {
      itemsR.quiet(true);
      if (outsideQuiet) outsideQuiet();
      outsideQuiet = timers.later(() => {
        outsideQuiet = null;
        if (!disposed) itemsR.quiet(false);
      }, 700);
      return;
    }
    if (outsideQuiet) { outsideQuiet(); outsideQuiet = null; itemsR.quiet(false); }
    if (event.target?.closest?.(".pxd-view-dialog")) {
      if (event.key === "Escape") closeViewDialog();
      return;
    }
    if (highlightDialog) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeHighlightDialog();
      }
      return;
    }
    // Nothing selected and the key is outside every board: do not read the model.
    // Escape still ends PDF interact, or stays with native fullscreen, when the reader is up.
    // A fullscreen board, or one under the pointer, still owns a key whose focus sits on the body.
    if (!isFullscreen && pointerBoard !== root && boardKeyIsOutside(event.target, selection.items.length > 0)) {
      const overlay = menu.isOpen() || shortcutSheet.isOpen() || chrome.popover.isOpen() || chrome.changelog?.isOpen() || blockEdit;
      if (!overlay && consumePdfEscape()) return;
      return;
    }
    // Outline mode is real Roam blocks. Canvas shortcuts stay off so a key there is not a board command.
    if (outlineMode && !event.target?.closest?.(".pxd-mode")) return;
    if (tableMode && !event.target?.closest?.(".pxd-toolbar__table")) return;
    if (kanbanMode && !event.target?.closest?.(".pxd-toolbar__kanban")) return;
    // The Add to board picker sits outside every root. Escape closes it; other keys stay with its filter.
    const addBoard = doc.querySelector?.(".pxd-addboard");
    if (addBoard) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        addBoard.dispatchEvent(new CustomEvent("pxd-close"));
      }
      return;
    }
    // The open menu owns the keyboard; Quick Look and a presentation only let their own keys through.
    if (menu.isOpen()) return;
    if (shortcutSheet.isOpen()) {
      if (event.key === "Escape" || event.key === "?") {
        event.preventDefault();
        event.stopPropagation();
        shortcutSheet.close();
      }
      return;
    }
    const cardHost = doc.activeElement?.closest?.(".pxd-item, .pxd-section");
    const chord = { key: event.key, code: event.code, shift: event.shiftKey, alt: event.altKey, meta: event.metaKey, ctrl: event.ctrlKey };
    if (cardHost && root.contains(cardHost) && findShortcut(chord, "view")?.action === "cardMenu") {
      event.preventDefault();
      event.stopPropagation();
      openFocusedCardMenu(cardHost);
      return;
    }
    if (event.key === "Escape" && blockEdit && !doc.querySelector?.(".rm-autocomplete__results")) {
      event.preventDefault();
      event.stopPropagation();
      closeBlockEdit();
      return;
    }
    if (event.key === "Escape" && hoverUid) hideHover();
    // Escape closes the Background popover before the controller's chain (selection, up a level, fullscreen) runs.
    if (event.key === "Escape" && chrome.popover.isOpen()) { chrome.popover.close(); noteOverlayClosed(); event.preventDefault(); event.stopPropagation(); return; }
    if (event.key === "Escape" && chrome.changelog?.isOpen()) { chrome.changelog.close(); noteOverlayClosed(); event.preventDefault(); event.stopPropagation(); return; }
    if (quicklook.isOpen() && event.key !== "Escape" && String(event.key).toLowerCase() !== "q") return;
    if (presenter.isActive() && !["Escape", "ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "PageDown", "PageUp", " ", "p", "P"].includes(event.key)) return;
    // A live reader takes Escape before the board chain (selection, up a level, board fullscreen).
    if (consumePdfEscape()) return;
    const findKey = (event.metaKey || event.ctrlKey) && !event.altKey && String(event.key).toLowerCase() === "f";
    const findInSearch = event.target?.closest?.(".pxd-search") || doc.activeElement?.closest?.(".pxd-search");
    if (findKey && findInSearch && root.contains?.(findInSearch)) {
      event.preventDefault();
      event.stopPropagation();
      chrome.search.open();
      return;
    }
    const inputFocused = isTextEntryTarget(event.target) || isTextEntryTarget(doc.activeElement);
    if (inputFocused) {
      const inside = root.contains?.(event.target) || root.contains?.(doc.activeElement);
      if (!inside && !itemsR.isEditing()) return;
      // Cmd+Z and Cmd+Shift+Z belong to the focused editor. Board undo runs only when focus is on the board.
      if ((event.metaKey || event.ctrlKey) && !event.altKey && String(event.key).toLowerCase() === "z") return;
    } else if (!ownsKeyboard()) {
      return;
    }
    const tableKey = ownershipOf({ target: event.target, active: doc.activeElement, pointerTarget: tablePointer, boardRoot: root });
    if (keyGate(event, tableKey).yield) return;
    // Roam dropped focus to <body> mid-edit: put it back on the editor instead of running a board shortcut.
    if (!inputFocused && itemsR.isEditing() && event.key !== "Escape") { itemsR.recoverFocus(); return; }
    if (inputFocused && itemsR.isEditing()) {
      const ta = String(event.target?.tagName || "").toLowerCase() === "textarea" ? event.target : doc.activeElement;
      if (ta && String(ta.tagName || "").toLowerCase() === "textarea") {
        const uid = itemsR.editingUid();
        const role = inputBlockRole(ta, uid);
        const action = editorKeyAction({
          key: event.key,
          shift: event.shiftKey,
          meta: event.metaKey,
          ctrl: event.ctrlKey,
          alt: event.altKey,
          autocomplete: itemsR.autocompleteOpen(),
          isRoot: role.role === "root",
          fresh: freshItems.has(uid),
          value: ta.value || "",
          selectionStart: Number.isFinite(ta.selectionStart) ? ta.selectionStart : 0,
          selectionEnd: Number.isFinite(ta.selectionEnd) ? ta.selectionEnd : (Number.isFinite(ta.selectionStart) ? ta.selectionStart : 0),
          enterMode: setting("enter-in-card", "newline"),
        });
        // Roam's own Enter handler never sees the key. The browser's default action
        // still types the newline, so Roam's onChange records it as it does Shift+Enter.
        // A scripted insert changed the textarea but Roam saved the old string.
        // Roam must miss the matching keyup too: an Enter keyup with no keydown leaves
        // its editor stale, and the next keystroke reset the text to the saved string.
        if (action.type === "newline") {
          event.stopPropagation();
          event.stopImmediatePropagation?.();
          swallowEnterUp = true;
          return;
        }
        if (action.type === "delete-card") {
          event.preventDefault();
          event.stopPropagation();
          void exitEdit();
          return;
        }
      }
    }
    // Tab walks the outline only while focus is on the board itself: not for a resting pointer, and not on a toolbar control.
    const focused = doc.activeElement;
    const onCard = Boolean(focused?.closest?.(".pxd-item, .pxd-section"));
    const onChrome = Boolean(focused?.closest?.(".pxd-chrome"));
    const tabOwned = Boolean(focused) && !onCard && (focused === root || (Boolean(root.contains?.(focused)) && !onChrome));
    // Enter and Space belong to the focused control. They must not rename the selection.
    // Roam cancels Enter before a button's own activation, so Enter clicks that button here. Space still does.
    if (onChrome && root.contains(focused) && (event.key === "Enter" || event.key === " ")) {
      if (event.key === "Enter" && String(focused.tagName || "").toLowerCase() === "button" && !focused.disabled) {
        event.preventDefault();
        focused.click();
      }
      return;
    }
    // G2. Enter opens the pane. Plain arrows flip the selected PDF. Shift-arrows still nudge.
    // Space stays "hold to pan". A key inside the reader, or a flipper that is not live, falls through.
    if (!inputFocused && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey
      && !event.target?.closest?.(".pxd-read, .rm-pdf-container, .pxd-pdf-reader")) {
      const only = selection.items.length === 1 ? board()?.items.get(selection.items[0]) : null;
      if (only?.kind === "pdf" && event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        try { itemsR.openPdf?.(only.uid); } catch { /* host */ }
        return;
      }
      if (only?.kind === "pdf" && pdfFlip?.consumeKey?.(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }
    // POL-4. A trail stop and the region layer handle their own arrows and Enter.
    const owned = event.target?.closest?.(".pxd-trail__stop, .pxd-region-layer");
    if (owned && root.contains(owned)) return;
    const handled = ctl.handle({ type: "keydown", key: event.key, code: event.code, shift: event.shiftKey, alt: event.altKey, meta: event.metaKey, ctrl: event.ctrlKey, inputFocused, tabOwned });
    if (handled) { event.preventDefault(); event.stopPropagation(); }
  };
  const onKeyUp = (event) => {
    if (typeAhead.takeUp(event)) return;
    if (swallowEnterUp && event.key === "Enter") {
      swallowEnterUp = false;
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      return;
    }
    ctl.handle({ type: "keyup", key: event.key, code: event.code });
  };
  // A typed edit anywhere else in Roam lands on Roam's undo stack: the grouped undo log no longer maps onto it.
  listen(doc, "input", (event) => {
    if (!root.contains?.(event.target)) host?.invalidateUndo?.();
  }, true);
  // Capture phase: Roam's document-level shortcuts (Delete/Backspace on block selection, etc.) stop propagation
  // before a bubble listener on window. onKeyDown returns early for any text input outside the board.
  listen(win, "keydown", onKeyDown, true);
  listen(win, "keyup", onKeyUp, true);
  listen(win, "beforeinput", typeAhead.takeInput, true);
  listen(win, "textInput", typeAhead.takeText, true);
  // The new card's textarea took focus: replay the kept keys on the next frame, once Roam has bound it.
  listen(win, "focusin", (event) => {
    if (!typeAhead.isArmed() || !root.contains?.(event.target)) return;
    timers.frame(() => { if (!disposed && doc.activeElement === event.target) typeAhead.flush(event.target); });
  }, true);

  // ------------------------------------------------------------ clipboard
  const clip = createClipboardIO({
    doc,
    root,
    ownsKeyboard,
    isTextEntry: isTextEntryTarget,
    on: {
      getPayload: ({ cut = false } = {}) => {
        const b = board();
        if (!b || !selection.items.length) return null;
        const payload = copyPayload(b, selection.items, rects());
        if (!payload.text) return null;
        // A cut deletes the blocks, so the payload carries a snapshot of them for the paste to clone from.
        if (cut) {
          const snapshot = session.snapshotItems?.(selection.items);
          if (snapshot) {
            try { payload.mime = JSON.stringify({ ...JSON.parse(payload.mime), snapshot }); } catch { /* keep refs */ }
          }
        }
        lastPayload = payload;
        return payload;
      },
      cutDone: () => {
        cutting = true;
        try { ctl.deleteSelection(true); } finally { cutting = false; }
      },
      pastePlexus: (data, opts) => pastePlexus(data, opts),
      pasteText: (entries) => pasteEntries(entries),
      pasteImages: (files) => { void pasteImages(files); },
      pasteCardJson: (data) => {
        const plan = pasteCardPlan(data, pastePoint());
        if (!plan) return;
        Promise.resolve(session.insertParsedCard?.({
          x: plan.x,
          y: plan.y,
          w: plan.w,
          h: plan.h,
          markdown: plan.markdown,
          ...(plan.sourceUid ? { sourceUid: plan.sourceUid } : {}),
        })).then(afterCreate("Pasted")).catch(() => {});
      },
      editorPaste,
    },
  });
  onFail.unshift(() => clip.dispose());

  // ------------------------------------------------------------ session events
  subs.push(session.on("change", ({ dirty: d, structural } = {}) => {
    if (disposed || suspended) return;
    const b = board();
    const current = crumbList[crumbList.length - 1];
    if (current && b) {
      const title = b.title || UNTITLED_BOARD;
      if (current.title !== title) { current.title = title; chrome.toolbar.setCrumbs(crumbList); }
    }
    if (structural || !d) dirty.structural = true;
    if (d && b) {
      for (const uid of d) {
        if (b.edges.has(uid)) dirty.edges.add(uid); else dirty.items.add(uid);
      }
    } else dirty.all = true;
    if (!d || d.has?.(boardUid)) applyBackground();
    ctl.reconcile();
    dirty.selection = true;
    schedule();
    if (outlineMode) syncOutline();
    if (tableMode) tableCtl.refresh();
    if (kanbanMode) kanbanCtl.refresh();
    if (laterCtl.isOpen()) laterCtl.refresh();
    panel.refreshViews?.();
  }));
  subs.push(session.on("links", () => { if (disposed || suspended) return; dirty.links = true; schedule(); }));
  subs.push(session.on("sync", (state) => { if (disposed || suspended) return; chrome.toolbar.setSync(state); }));
  subs.push(session.on("toast", (t) => { if (disposed || suspended) return; chrome.toast.show(t); }));
  tableCtl = mountTable({
    doc,
    root,
    host,
    getBoard: board,
  });
  let kanbanBtOn = null;
  const syncKanbanTask = () => {
    const on = readSetting("better-tasks") === true;
    if (kanbanBtOn === on) return;
    const wasOpen = kanbanMode;
    kanbanCtl.dispose();
    const next = mountKanban({
      doc,
      root,
      host,
      bt,
      getBoard: board,
      toast: (message) => toast(message),
      ...(on ? { completeTask: (uid) => taskDone.complete(uid) } : {}),
    });
    kanbanCtl = next;
    kanbanBtOn = on;
    if (wasOpen) kanbanCtl.open();
  };
  syncKanbanTask();
  laterCtl = mountLater({
    doc,
    root,
    host,
    getBoard: board,
    onClose: () => laterCtl.close(),
  });
  if (inSidebar) setOutline(readSidebarMode() === "outline");

  // ------------------------------------------------------------ observers
  const RO = globalThis.ResizeObserver;
  if (typeof RO === "function") {
    try {
      const ro = trackObserver(new RO(() => {
        if (disposed || suspended) return;
        measure(); markViewport(); chrome.ctx.reposition(); chrome.toolbar.scheduleDock?.();
      }));
      ro.observe(root);
      observers.push(ro);
      // The board area shrinks and grows with the reader (beside or stacked). The minimap and the context bar's
      // overflow follow it, including after the pane closes.
      // The viewport edge slides for ~180 ms when the pane opens or closes; measure once it has settled
      // instead of forcing a layout on every frame of the slide while the reader loads.
      let areaWait = null;
      const area = trackObserver(new RO(() => {
        if (disposed || suspended) return;
        areaWait?.();
        areaWait = timers.later(() => {
          areaWait = null;
          if (disposed || suspended) return;
          syncCramped();
          chrome.ctx.reposition();
          chrome.toolbar.scheduleDock?.();
        }, 240);
      }));
      area.observe(viewport);
      observers.push(area);
    } catch { /* stub */ }
  }
  const MO = globalThis.MutationObserver;
  if (typeof MO === "function") {
    try {
      let settle = null;
      const mo = trackObserver(new MO(() => {
        if (disposed || suspended) return;
        applyTheme();
        settle?.(); // a host background may still be transitioning when its marker class flips: measure once more after it
        settle = timers.later(() => { settle = null; if (!disposed && !suspended) applyTheme(); }, 300);
      }));
      for (const node of [doc.documentElement, doc.body]) if (node) mo.observe(node, { attributes: true, attributeFilter: ["class"] });
      observers.push(mo);
    } catch { /* stub */ }
  }
  try {
    const mq = win?.matchMedia?.("(prefers-color-scheme: dark)");
    if (mq?.addEventListener) listen(mq, "change", () => { if (!disposed) applyTheme(); });
  } catch { /* no matchMedia */ }
  try {
    if (motionMq?.addEventListener) listen(motionMq, "change", () => { if (!disposed) applyMotion(); });
  } catch { /* no matchMedia */ }
  try { themeFollow?.start?.(); } catch { /* theme */ }
  routeOff = watchRouteExit({ boardUid: routeUid, onExit: () => { if (isFullscreen) requestFullscreen(false); }, win });

  // ------------------------------------------------------------ render frame
  const renderFrame = () => {
    if (disposed || suspended) return;
    const b = board();
    if (!b) return;
    if (!coverPaintAt) {
      coverPaintAt = Date.now();
      armCoverWarm();
      scheduleTitleLexiconWarm({
        win,
        hasPdf: () => [...b.items.values()].some((it) => it?.kind === "pdf"),
        ocr: sharedDeviceOcr,
        isDisposed: () => disposed,
        onWarm: () => {
          try { itemsR?.repaintStyles?.(); } catch { /* paint */ }
          try { readPane?.refreshCards?.(); } catch { /* switcher */ }
        },
        setTimer: (fn, ms) => timers.later(fn, ms),
      });
    }
    let itemsChanged = false;
    if (dirty.all || dirty.structural || dirty.items.size) {
      // Live preview rects (edit growth, drag fit) ride along: a sync for a dirty card must not snap grown section shells back.
      itemsR.sync({
        board: b,
        rects: paintRects(),
        dirty: dirty.all ? null : dirty.items,
        structural: dirty.structural,
        view: size.width ? visibleWorldRect(vp, size, CULL_MARGIN) : null,
      });
      if (laneMarks || lanePreviewLayout) applyLaneMarks();
      ensurePdfHighlightButtons(dirty.all || dirty.structural ? null : dirty.items);
      syncEmptyHint(emptyHint, b);
      itemsChanged = true;
      syncTrailPaint(b);
      if ((dirty.all || dirty.structural) && panel.currentTab?.() === "trails") panel.refreshTrails?.();
    }
    const edgesDue = dirty.all || dirty.structural || dirty.links || dirty.edges.size;
    // A collapse dirties only the section. Edges into its members still have to move
    // onto the short frame, even when no edge block itself changed.
    const itemsMoveEdges = dirty.items.size && !dirty.all && !dirty.structural;
    if (edgesDue || itemsMoveEdges) {
      const shown = paintRects();
      if (edgesDue) {
        // An edge-only change used to call update(), which moves the path and skips
        // paintEdge, so dash and color never reached the DOM until a full render.
        const links = paintedLinks();
        edgesR.render({ board: b, rects: shown, links, coveredEdges: session.coveredEdges || new Set(), selection, zoom: vp.zoom, dirty: dirty.all || dirty.structural || dirty.links ? null : dirty.edges });
        paintLegend();
        if (suggestMode !== "off") refreshSuggest();
      }
      if (itemsMoveEdges) {
        const links = paintedLinks();
        edgesR.update({ board: b, edgeUids: edgesTouching(b, dirty.items), rects: shown, zoom: vp.zoom, linkKeys: new Set(links.map((l) => l.key)), links });
        if (suggestMode !== "off") refreshSuggest();
      }
      if (lanePreviewLayout) updateLaneEdges(b);
    }
    if (dirty.viewport) {
      world.style.transform = `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`;
      // Roam Caret re-places its caret when a field on the board is focused and the camera moves.
      const focused = doc.activeElement;
      if (focused?.tagName === "TEXTAREA" && root.contains(focused)) {
        try { win?.dispatchEvent?.(new win.CustomEvent("plexus-diagram:camera")); } catch { /* no caret */ }
      }
      itemsR.setZoom(vp.zoom);
      paintInvZoom();
      // The tier flips (classes + font variables, once) the moment the zoom crosses the threshold, mid-gesture too.
      const nextTier = lodTier(vp.zoom, tier, { threshold: mapThreshold() });
      if (nextTier !== tier) { tier = nextTier; paintTier(); pdfFlip?.setLod?.(tier); chrome.toolbar.scheduleDock?.(); }
      if (!gesturing) {
        const g = gridBackground(vp, bgPattern);
        if (g) {
          grid.style.backgroundSize = `${g.size}px ${g.size}px`;
          grid.style.backgroundPosition = `${g.x}px ${g.y}px`;
          if (bgPattern === "grid") {
            const mod = (v) => ((v % g.major) + g.major) % g.major;
            grid.style.setProperty("--pxd-grid-major", `${g.major}px`);
            grid.style.setProperty("--pxd-grid-major-x", `${mod(vp.x)}px`);
            grid.style.setProperty("--pxd-grid-major-y", `${mod(vp.y)}px`);
          }
        }
      }
      chrome.toolbar.setZoom(vp.zoom);
      if (tooltip.isVisible()) tooltip.hide();
      // offsetHeight in place() forces layout. During a gesture the toolbar height
      // does not change, and that read was the long task on a 300-card board.
      if (!gesturing) propsPanel.place();
    }
    if (dirty.viewport && !gesturing && liftedUids.size + (liftHoverUid ? 1 : 0) + selection.items.length > 0) liftBurst = true;
    if (dirty.selection || itemsChanged) {
      itemsR.setSelection(selection.items);
      syncPdfFlip();
      edgesR.setSelection({ edge: selection.edge, link: selection.link });
      if (suggestMode !== "off" && selection.items.join("|") !== suggestSelKey) refreshSuggest();
      if (!gesturing && !itemsR.isEditing()) showCtx(); else chrome.ctx.hide();
      scheduleLift();
      syncProps();
      if (lensTag && dirty.structural) rebuildLens();
      if (focusOn || lensTag) applyFocus();
    } else if (dirty.viewport && chrome.ctx.isOpen()) {
      chrome.ctx.reposition();
    }
    if (dirty.viewport && !gesturing && liftedUids.size + (liftHoverUid ? 1 : 0) + selection.items.length > 0) scheduleLiftIdle();
    if (itemsChanged || dirty.minimap || (dirty.viewport && !gesturing)) {
      const shown = paintRects();
      chrome.minimap.update({ board: b, rects: shown, vp, size });
      paintLandmarkDots(b, shown);
    }
    if (itemsChanged && !gesturing) {
      scheduleContent();
      updateBackToContent();
      panel.refreshOutline();
      if (dirty.all || dirty.structural) scheduleBadges(50);
    }
    if (edgesDue || itemsChanged || itemsMoveEdges) {
      if (refreshBlockCards()) scheduleAnchors();
      else edgesR.setMeasures(new Map());
    }
    if (searchMatches.length || root.classList.contains("pxd-root--searching")) panel.refreshMarks();
    if (itemsChanged || edgesDue || itemsMoveEdges) paintLenses();
    dirty.minimap = false;
    dirty.viewport = false;
    dirty.items = new Set();
    dirty.edges = new Set();
    dirty.structural = false;
    dirty.all = false;
    dirty.selection = false;
    dirty.links = false;
  };

  // ------------------------------------------------------------ deep link
  const pulseItem = (uid) => {
    const shell = itemsR.shellOf(uid);
    if (!shell) return;
    const ms = motionProfile(currentMotion()).pulseMs;
    shell.classList.remove("pxd-item--pulse");
    if (ms <= 0) return;
    void shell.offsetWidth;
    shell.classList.add("pxd-item--pulse");
    timers.later(() => { if (!disposed) shell.classList.remove("pxd-item--pulse"); }, ms);
  };
  const haloCache = new Map();
  const haloPending = new Map();
  const haloButtons = new Set();
  let haloPop = null;
  let haloWait = null;
  let haloGen = 0;
  const sectionTitle = (originUid) => {
    const b = board();
    let uid = originUid;
    let guard = 0;
    while (uid && b && uid !== b.uid && guard < 40) {
      const item = b.items.get(uid);
      if (!item) break;
      if (item.type === "section") return item.title || "";
      uid = item.parentUid;
      guard += 1;
    }
    return "";
  };
  const boardCount = (target) => {
    let n = 1;
    if (!target) return n;
    try {
      const list = win?.PlexusDiagram?.boardsWith?.(target);
      if (Array.isArray(list) && list.length) {
        const here = board()?.uid;
        n = list.some((row) => row && row.uid === here) ? list.length : list.length + 1;
      }
    } catch { n = 1; }
    return n;
  };
  const cardLabel = (uid) => {
    const title = String(board()?.items.get(uid)?.title || "").trim();
    if (!title || title.length > 40) return "card";
    return title;
  };
  const loadHalo = (subject) => {
    const uid = subject?.uid;
    if (!uid) return Promise.resolve(null);
    const hit = haloCache.get(uid);
    if (hit && Date.now() - hit.at < 60000) return Promise.resolve(hit.model);
    const pending = haloPending.get(uid);
    if (pending) return pending;
    const job = (async () => {
      try {
      let pulled = null;
      try { pulled = host?.pullEntity?.(HALO_PULL_LIGHT, uid) || null; } catch { pulled = null; }
      const read = readHaloPull(pulled);
      const refs = haloRefs(typeof host?.q === "function" ? host.q.bind(host) : null, uid);
      const b = board();
      const cardUids = [];
      if (b) for (const item of b.items.values()) {
        if (item?.type === "card" && item.uid) cardUids.push(item.uid);
      }
      const stamps = new Map();
      if (cardUids.length && typeof host?.q === "function") {
        let found = [];
        try {
          found = host.q("[:find ?u ?t :in $ [?u ...] :where [?e :block/uid ?u] [?e :create/time ?t]]", cardUids) || [];
        } catch { found = []; }
        for (const row of found) {
          if (Array.isArray(row) && row.length >= 2) stamps.set(row[0], row[1]);
        }
      }
      const rows = cardUids.map((id) => ({
        uid: id,
        created: id === uid && read.created != null ? read.created : stamps.get(id),
      }));
      if (!rows.some((row) => row.uid === uid)) rows.push({ uid, created: read.created });
      const origin = subject.from ? subject.from : uid;
      const target = subject.target?.uid || uid;
      const model = {
        created: read.created,
        edited: read.edited,
        userName: read.userName,
        board: b?.title || "",
        section: sectionTitle(origin),
        with: company(rows, uid).map((id) => ({ uid: id, label: cardLabel(id) })),
        refTimes: refs.times,
        refTotal: refs.total,
        boards: boardCount(target),
      };
      haloCache.set(uid, { at: Date.now(), model });
      return model;
      } catch { return null; }
    })();
    haloPending.set(uid, job);
    job.finally(() => { if (haloPending.get(uid) === job) haloPending.delete(uid); });
    return job;
  };
  const haloSubjectNow = () => {
    const b = board();
    if (!b || disposed) return null;
    if (selection.edge) {
      const edge = b.edges.get(selection.edge);
      if (edge) return edge;
    }
    const it = singleItem();
    if (it && it.type !== "section") return it;
    return null;
  };
  const showHalo = async (subject, anchor) => {
    const gen = haloGen;
    const model = await loadHalo(subject);
    if (disposed || !model || gen !== haloGen) return;
    try { haloPop?.close(); } catch { /* already closed */ }
    haloPop = openHaloPopover({
      doc,
      anchor,
      model,
      pageExists: (label) => {
        try { return Boolean(host?.pageUid?.(label)); } catch { return false; }
      },
      renderString: (el, string) => host?.renderString?.(el, string),
      unmount: (el) => { try { host?.unmount?.(el); } catch { /* already gone */ } },
      onPulse: (id) => { if (!disposed) pulseItem(id); },
      dustAge: subject && !subject.from && !subject.to
        ? (itemsR.shellOf(subject.uid)?.getAttribute?.("data-dust-age") || "")
        : "",
    });
  };
  openHalo = (subject, anchor) => {
    const sub = subject?.uid ? subject : haloSubjectNow();
    if (!sub?.uid || sub.type === "section") return;
    const btn = root.querySelector?.(".pxd-toolbar__info");
    const box = anchor || btn?.getBoundingClientRect?.() || { left: 24, top: 24, right: 56, bottom: 48 };
    void showHalo(sub, box);
  };
  contextLineFor = async (subject) => {
    if (!subject?.uid || subject.type === "section") return "";
    const model = await loadHalo(subject);
    return model ? headerText(model) : "";
  };
  closeHalo = () => {
    haloGen += 1;
    haloWait?.();
    haloWait = null;
    try { haloPop?.close(); } catch { /* already closed */ }
    haloPop = null;
  };
  bindInfoHover = () => {
    const btn = root.querySelector?.(".pxd-toolbar__info");
    if (!btn || haloButtons.has(btn)) return;
    haloButtons.add(btn);
    const armHalo = () => {
      haloWait?.();
      haloWait = timers.later(() => {
        haloWait = null;
        if (!disposed) openHalo();
      }, 400);
    };
    listen(btn, "pointerenter", armHalo);
    listen(btn, "mouseenter", armHalo);
    listen(btn, "pointerleave", () => { haloWait?.(); haloWait = null; });
    listen(btn, "mouseleave", () => { haloWait?.(); haloWait = null; });
    listen(btn, "pointerdown", () => { haloWait?.(); haloWait = null; });
  };
  bindInfoHover();
  listen(doc, "pointerdown", (event) => {
    if (event.target?.closest?.(".pxd-halo")) return;
    haloGen += 1;
    haloWait?.();
    haloWait = null;
    if (!haloPop?.el) return;
    try { haloPop.close(); } catch { /* already closed */ }
    haloPop = null;
  }, true);
  const fracParts = (frac) => {
    if (Array.isArray(frac)) return { rx: Number(frac[0]), ry: Number(frac[1]), rw: Number(frac[2]), rh: Number(frac[3]) };
    const src = frac || {};
    return { rx: Number(src.rx), ry: Number(src.ry), rw: Number(src.rw), rh: Number(src.rh) };
  };
  const pulseFraction = (img, frac) => {
    const ms = motionProfile(currentMotion()).pulseMs;
    if (!(ms > 0) || !img) return;
    const imgBox = img.getBoundingClientRect?.();
    const rootBox = root.getBoundingClientRect?.() || { left: 0, top: 0 };
    if (!imgBox || !(imgBox.width > 0) || !(imgBox.height > 0)) return;
    const f = fracParts(frac);
    if (![f.rx, f.ry, f.rw, f.rh].every((n) => Number.isFinite(n))) return;
    const node = doc.createElement("div");
    node.className = "pxd-item--pulse";
    node.style.position = "absolute";
    node.style.pointerEvents = "none";
    node.style.left = `${(imgBox.left - rootBox.left) + f.rx * imgBox.width}px`;
    node.style.top = `${(imgBox.top - rootBox.top) + f.ry * imgBox.height}px`;
    node.style.width = `${f.rw * imgBox.width}px`;
    node.style.height = `${f.rh * imgBox.height}px`;
    root.append(node);
    timers.later(() => { if (!disposed) node.remove(); }, ms);
  };
  const consumeDeepLink = (hash = win?.location?.hash || "") => {
    if (disposed) return false;
    const target = pxdTarget(hash);
    if (!target?.cardUid) return false;
    const b = board();
    const edge = b?.edges?.get(target.cardUid);
    if (!b || (!b.items.has(target.cardUid) && !edge)) return false;
    let pageUid = "";
    try { pageUid = host?.blockPageUid?.(boardUid) || ""; } catch { pageUid = ""; }
    if (target.pageUid && pageUid && target.pageUid !== pageUid) return false;
    // RF-3: a connection block's uid lands on the connection: select it, frame both cards, pulse them.
    if (edge && !b.items.has(target.cardUid)) {
      ctl.selectEdge(edge.uid);
      const ends = focusEnds(b, edge);
      fitSelection(ends.length ? ends : [edge.from, edge.to]);
      for (const uid of (ends.length ? ends : [edge.from, edge.to])) {
        if (itemsR.shellOf(uid)) pulseItem(uid);
        else timers.frame(() => { if (!disposed) pulseItem(uid); });
      }
      const revealEnd = (card, block) => {
        if (!card || !block) return;
        itemsR.revealRow(card, block);
      };
      revealEnd(b.items.has(edge.from) ? edge.from : null, edge.fromBlock);
      revealEnd(b.items.has(edge.to) ? edge.to : null, edge.toBlock);
      for (const end of [edge.from, edge.to]) {
        if (b.items.has(end)) continue;
        const inner = b.edges.get(end);
        if (!inner) continue;
        const card = b.items.has(inner.from) ? inner.from : (b.items.has(inner.to) ? inner.to : null);
        const block = b.items.has(inner.from) ? inner.fromBlock : inner.toBlock;
        revealEnd(card, block);
      }
      return true;
    }
    ctl.select([target.cardUid]);
    fitSelection([target.cardUid]);
    if (itemsR.shellOf(target.cardUid)) pulseItem(target.cardUid);
    else timers.frame(() => { if (!disposed) pulseItem(target.cardUid); });
    return true;
  };
  listen(win, "hashchange", (event) => {
    const fromEvent = hashFromUrl(event?.newURL);
    consumeDeepLink(fromEvent || undefined);
  });

  // ------------------------------------------------------------ boot
  applyFullscreen(fullscreen);
  measure();
  if (autofocus) { try { root.focus({ preventScroll: true }); } catch { /* stub */ } }
  if (!vp) {
    const b = board();
    const r = b ? rects() : new Map();
    vp = fitViewport(boundsOf([...r.values()]), size.width && size.height ? size : { width: 800, height: 560 }, { padding: 64, maxZoom: 1 });
  }
  applyBackground();
  applyMotion();
  applyLod();
  itemsR.setShowBadges(flag("show-card-badges", true));
  dirty.viewport = true;
  markAll();
  consumeDeepLink();
  timers.later(() => { if (!disposed && !suspended) { scheduleContent(); updateBackToContent(); } }, 0);

  // ------------------------------------------------------------ API
  const localDay = (date = new Date()) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };
  const blobToDataUrl = (blob) => new Promise((resolve) => {
    const Reader = globalThis.FileReader;
    if (typeof Reader !== "function" || !blob) { resolve(""); return; }
    const reader = new Reader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => resolve("");
    try { reader.readAsDataURL(blob); } catch { resolve(""); }
  });
  const dataUrlFor = async (src) => {
    if (typeof src !== "string" || !src) return "";
    if (src.startsWith("data:")) return src;
    if (typeof host?.getFile !== "function") return "";
    try {
      const file = await host.getFile(src);
      const data = await blobToDataUrl(file);
      return data.startsWith("data:") ? data : "";
    } catch { return ""; }
  };
  const svgOf = async (b, uids = null) => {
    const pictured = uids ? sliceBoard(b, uids) : b;
    const hrefs = new Map();
    for (const item of pictured.items.values()) {
      if (item.kind !== "image") continue;
      const data = await dataUrlFor(imageSrc(item.string));
      if (data) hrefs.set(item.uid, data);
    }
    const text = boardToSvg(pictured, rects(), { dark: root.classList.contains("pxd-root--dark"), imageHrefs: hrefs });
    return dropExternalImages(text);
  };
  const pngName = (b) => {
    let pageTitle = "";
    try { pageTitle = host?.pageTitleOf?.(b.uid) || ""; } catch { pageTitle = ""; }
    return pngFileName({ boardTitle: b.title || UNTITLED_BOARD, pageTitle, date: localDay() });
  };
  async function pngBlob(b, uids = null) {
    return rasterizeSvg(doc, await svgOf(b, uids));
  }
  async function exportPng() {
    const b = board();
    if (!b) return false;
    try {
      const blob = await pngBlob(b);
      if (!blob) { if (!disposed) toast("PNG failed"); return false; }
      const url = URL.createObjectURL(blob);
      const a = doc.createElement("a");
      a.href = url;
      a.download = pngName(b);
      doc.body.append(a);
      a.click();
      a.remove();
      timers.later(() => URL.revokeObjectURL(url), 4000);
      if (!disposed) toast("Saved PNG");
      return true;
    } catch {
      if (!disposed) toast("PNG failed");
      return false;
    }
  }
  async function copySelectionPng(uids) {
    const b = board();
    if (!b || !uids?.length) { if (!disposed) toast("PNG failed"); return false; }
    try {
      const blob = await pngBlob(b, uids);
      const Item = globalThis.ClipboardItem;
      const write = globalThis.navigator?.clipboard?.write;
      if (!blob || typeof Item !== "function" || typeof write !== "function") { if (!disposed) toast("Copy failed"); return false; }
      await write.call(globalThis.navigator.clipboard, [new Item({ "image/png": blob })]);
      if (!disposed) toast("Copied PNG");
      return true;
    } catch {
      if (!disposed) toast("Copy failed");
      return false;
    }
  }

  const view = {
    refreshStatuses() { itemsR?.refreshStatuses?.(); kanbanCtl?.refresh?.(); },
    root,
    controller: ctl,
    setFullscreen(on) { if (Boolean(on) !== isFullscreen) applyFullscreen(on); },
    fit() { fitAll(); },
    // Select and pulse a card or connection by uid, without a page check (feature.js enters a nested board first).
    walkTrail(trailUid) {
      if (disposed || !board()) return false;
      if (trailUid) activeTrailUid = trailUid;
      startWalk("trail");
      return true;
    },
    focusUid(uid) {
      const ok = consumeDeepLink(`#?pxd=${encodeURIComponent(uid)}`);
      // A board inline on a long page: bring it on screen so the pulse is seen.
      if (ok && !isFullscreen) { try { mountEl?.scrollIntoView?.({ block: "center" }); } catch { /* no layout */ } }
      return ok;
    },
    viewport: () => ({ x: vp.x, y: vp.y, zoom: vp.zoom }),
    restoreViewport(next) {
      if (disposed || !next) return;
      const zoom = Number(next.zoom);
      if (!Number.isFinite(next.x) || !Number.isFinite(next.y) || !(zoom > 0)) return;
      moveViewport({ x: next.x, y: next.y, zoom });
    },
    // A kept board comes back into a new mount element (Roam re-rendered the page).
    // Point the view at it and re-apply fullscreen chrome or the inline height there.
    rebind(nextMount) {
      if (disposed || !nextMount || nextMount === mountEl) return;
      try { fsDispose(); } catch { /* no chrome applied */ }
      fsDispose = () => {};
      mountEl = nextMount;
      if (root.parentElement !== mountEl) mountEl.append(root);
      applyFullscreen(isFullscreen);
    },
    // Park every observer, frame, and document listener. The same functions stay
    // registered so dispose can still remove them. Resume paints one frame.
    suspend() {
      if (disposed || suspended) return;
      suspended = true;
      if (frameHandle) { const cancel = frameHandle; frameHandle = null; cancel(); }
      if (settleTimer) { settleTimer(); settleTimer = null; }
      if (resumeTimer) { resumeTimer(); resumeTimer = null; }
      if (badgeTimer) { badgeTimer(); badgeTimer = null; }
      if (outsideQuiet) { outsideQuiet(); outsideQuiet = null; }
      if (coverWarmWait) { coverWarmWait(); coverWarmWait = null; }
      try { pdfWarm?.cancelAll?.(); } catch { /* warm */ }
      try { cancelHoverGrace(); } catch { /* none armed */ }
      try { clearZoomAnim(); } catch { /* none armed */ }
      suspendObservers();
    },
    resume() {
      if (disposed || !suspended) return;
      suspended = false;
      resumeObservers();
      armCoverWarm();
      dirty.all = true;
      dirty.structural = true;
      schedule();
    },
    cameraRect() {
      return cameraRectOf({ x: vp.x, y: vp.y, zoom: vp.zoom }, viewSize());
    },
    applyShow(region) {
      if (disposed || !region) return;
      if (region.kind === "img") {
        let nudged = false;
        const place = (left) => {
          if (disposed) return;
          const card = rects().get(region.cardUid);
          const shell = itemsR.shellOf(region.cardUid);
          const img = shell?.querySelector?.("img");
          const shellBox = shell?.getBoundingClientRect?.();
          const imgBox = img?.getBoundingClientRect?.();
          const ready = card && shellBox && imgBox
            && shellBox.width > 0 && shellBox.height > 0
            && imgBox.width > 0 && imgBox.height > 0;
          if (!ready) {
            if (card && !nudged) {
              nudged = true;
              setViewport(regionCamera({
                imageRect: { x: card.x, y: card.y, w: card.w, h: card.h },
                frac: [0, 0, 1, 1],
                size: viewSize(),
              }));
            }
            if (left > 0) timers.later(() => place(left - 1), 100);
            return;
          }
          const imageRect = {
            x: card.x + ((imgBox.left - shellBox.left) / shellBox.width) * card.w,
            y: card.y + ((imgBox.top - shellBox.top) / shellBox.height) * card.h,
            w: (imgBox.width / shellBox.width) * card.w,
            h: (imgBox.height / shellBox.height) * card.h,
          };
          setViewport(regionCamera({ imageRect, frac: region.f, size: viewSize() }));
          timers.frame(() => { if (!disposed) pulseFraction(img, region.f); });
        };
        place(20);
        return;
      }
      if (region.kind !== "view") return;
      setViewport(setCameraFromView(region.v, viewSize()));
      const pulseLater = (id, left) => {
        if (disposed || left < 0) return;
        if (itemsR.shellOf(id)) { pulseItem(id); return; }
        timers.later(() => pulseLater(id, left - 1), 100);
      };
      for (const id of region.ids || []) pulseLater(id, 15);
    },
    // Swap the settings object (feature.js calls this when a setting changes) and re-apply what depends on it.
    setSettings(next) {
      if (disposed) return;
      const minimapBefore = setting("show-minimap", true) !== false;
      const opensBefore = trackOpensOn();
      const interopBefore = readSetting("interop") !== false;
      const coverBefore = readSetting("pdf-cover");
      const warmBefore = coverWarmOn();
      settingsRef = next;
      applyPdfDark();
      if (readSetting("pdf-cover") !== coverBefore) {
        forgetCovers();
        itemsR.repaintStyles();
      }
      if (coverWarmOn() !== warmBefore) {
        if (coverWarmOn()) armCoverWarm();
        else {
          if (coverWarmWait) { coverWarmWait(); coverWarmWait = null; }
          try { pdfWarm?.cancelAll?.(); } catch { /* warm */ }
        }
      }
      if (openStore) {
        try { openStore.setEnabled(trackOpensOn()); } catch { /* storage */ }
      }
      if (opensBefore !== trackOpensOn() && strengthOn) void refreshStrength();
      if (interopBefore !== (readSetting("interop") !== false)) {
        const live = board();
        if (live) for (const item of live.items.values()) {
          if (item?.kind === "drawing-ref" || item?.kind === "region-ref") dirty.items.add(item.uid);
        }
      }
      armSpeedLog();
      const nextLinks = setting("graph-links", "all");
      if (nextLinks !== linkMode && LINK_MODES.includes(nextLinks)) {
        linkMode = nextLinks;
        chrome.toolbar.setLinkMode(linkMode);
        session.setLinkMode?.(linkMode);
      }
      applyBackground();
      applyMotion();
      applyLod();
      const minimapNow = setting("show-minimap", true) !== false;
      if (minimapNow !== minimapBefore) chrome.minimap.setVisible(minimapNow);
      chrome.toolbar.applyControls?.();
      itemsR.setShowBadges(flag("show-card-badges", true));
      applyTaskSettings();
      if (readSetting("task-tool") !== true && ctl.getTool() === "task") ctl.setTool("select");
      syncKanbanTask();
      dirty.links = true;
      scheduleContent();
      scheduleBadges(0);
      dirty.viewport = true;
      schedule();
    },
    state() {
      return {
        zoom: vp.zoom,
        lod: tier,
        pattern: bgPattern,
        tone: bgTone ?? null,
        focus: focusOn,
        lens: lensTag,
        present: presenter.isActive(),
        selection: [...selection.items],
        mounted: itemsR.mountedCount(),
        menuOpen: menu.isOpen(),
      };
    },
    // Serializes the board to SVG text; with download it also offers the file through a temporary link.
    async exportSvg({ download = true } = {}) {
      const b = board();
      if (!b) return "";
      const text = boardToSvg(b, rects(), { dark: root.classList.contains("pxd-root--dark") });
      if (download) {
        try {
          const blob = new Blob([text], { type: "image/svg+xml" });
          const url = URL.createObjectURL(blob);
          const a = doc.createElement("a");
          a.href = url;
          a.download = `${String(b.title || UNTITLED_BOARD).replace(/[\\/:*?"<>|]+/g, "-").trim() || "board"}.svg`;
          doc.body.append(a);
          a.click();
          a.remove();
          timers.later(() => URL.revokeObjectURL(url), 4000);
        } catch { /* no Blob / URL in this environment: the text is still returned */ }
      }
      return text;
    },
    async exportPng() { return exportPng(); },
    addPage(at = null) { addPage(at); },
    newDrawing(at = null) {
      const d = DEFAULT_SIZES.card;
      const world = at || { x: 80, y: 80 };
      return session.createDrawing?.({ x: world.x - d.w / 2, y: world.y - d.h / 2 });
    },
    openPin,
    async copyOutline() {
      const b = board();
      if (!b) return "";
      const text = boardToMarkdown(b, rects());
      const ok = await writeClipboard({ text });
      if (!disposed) toast(ok ? "Outline copied" : "Copy failed");
      return text;
    },
    stats() {
      return { timers: timers.count(), listeners: listeners.length + (captured ? 3 : 0), observers: observers.length, mounted: itemsR.mountedCount(), shells: itemsR.shellCount() };
    },
    // P32 live probes: cover source (pdf.js or hidden reader) and the pane's fit path. Read-only.
    pdfProbe() {
      return { covers: coverReport(), fit: readPane?.fitInfo?.() || null, inline: itemsR.inlineUid?.() || "" };
    },
    dispose() {
      if (disposing) return;
      disposing = true;
      disposed = true;
      const step = (fn) => {
        try { fn(); } catch (error) { console.warn("[plexus-diagram] dispose step failed", error); }
      };
      // Each step stands alone. A throw used to set disposed and skip the body popover and the window listeners.
      step(() => perfLog?.cancelPan?.());
      step(() => { tabStrip?.remove(); tabStrip = null; root.classList.remove("pxd-root--fstabs"); });
      step(() => closeLinksMenu());
      step(() => { whyPop?.close(); whyPop = null; });
      step(() => { contextsDrawer?.close(); contextsDrawer = null; });
      step(() => {
        if (!memoryLane) return;
        memoryLane.close();
        memoryLane = null;
        clearLaneMarks();
      });
      step(() => closeHalo());
      step(() => { regionMark?.destroy?.(); regionMark = null; });
      step(() => closeViewDialog());
      step(() => closeHighlightDialog());
      step(() => closeLens());
      step(() => pagePicker?.close());
      step(() => closeBlockEdit());
      step(() => { if (pointerBoard === root) pointerBoard = null; });
      step(() => disconnectOutline());
      step(() => clearOutline());
      step(() => tableCtl.dispose());
      step(() => kanbanCtl.dispose());
      step(() => taskPop.dispose());
      step(() => laterCtl.dispose());
      step(() => stopTimer());
      step(() => { touchIds.clear(); clearPressWatch(); });
      step(() => ctl.cancel());
      step(() => releaseCapture());
      step(() => { if (heightDrag) onHeightUp(); });
      step(() => {
        doc.removeEventListener("pointermove", onDocMove, true);
        doc.removeEventListener("pointerup", onDocUp, true);
        doc.removeEventListener("pointercancel", onDocCancel, true);
        doc.removeEventListener("pointermove", onHeightMove, true);
        doc.removeEventListener("pointerup", onHeightUp, true);
      });
      step(() => subs.splice(0).forEach((off) => { try { off?.(); } catch { /* already off */ } }));
      step(() => routeOff());
      step(() => fsDispose());
      step(() => applyFullscreenChrome(mountEl, false, doc));
      step(() => { try { vpStore.set(vpId, vp); } catch { /* the store can refuse a write */ } });
      step(() => vpStore.flush?.());
      step(() => resumeTimer?.());
      step(() => settleTimer?.());
      step(() => frameHandle?.());
      step(() => badgeTimer?.());
      step(() => menu.dispose());
      step(() => quicklook.dispose());
      step(() => presenter.dispose());
      step(() => clip.dispose());
      step(() => { try { pdfWarm?.cancelAll?.(); } catch { /* warm */ } });
      step(() => {
        sharpStore.dispose();
        sharpTimer?.();
        sharpTimer = null;
      });
      step(() => { try { themeFollow?.stop?.(); } catch { /* theme */ } });
      step(() => { if (coverWarmWait) { coverWarmWait(); coverWarmWait = null; } });
      step(() => readPane?.dispose?.());
      step(() => itemsR.dispose());
      step(() => edgesR.dispose());
      step(() => panel.dispose());
      step(() => propsPanel.dispose());
      step(() => tooltip.dispose());
      step(() => chrome.dispose());
      step(() => listeners.splice(0).forEach((off) => { try { off(); } catch { /* already off */ } }));
      step(() => observers.splice(0).forEach((o) => { try { o.disconnect(); } catch { /* already off */ } }));
      step(() => timers.cancelAll());
      step(() => root.remove());
      // The acquirer (feature.js) owns session.release(); a second release here destroyed shared sessions.
      released = true;
      disposing = false;
    },
  };
  return view;
}

export function mountBoardView(options = {}) {
  const onFail = [];
  try {
    return buildBoardView(onFail, options);
  } catch (error) {
    for (const fn of onFail.splice(0)) {
      try { fn(); } catch (cleanupError) { console.warn("[plexus-diagram] dispose step failed", cleanupError); }
    }
    throw error;
  }
}
