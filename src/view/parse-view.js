// Parsed view. Renders a pxd-parse/1 document, runs the built-in engine page by
// page, and optionally asks the local helper. Parse, hover, locate, and column
// edits write nothing to the graph. Insert actions call session.insertParsed*
// when that other unit is present.

import { optionsHash, sha256Hex } from "../model/parse-hash.js";
import { assembleDocument, parsePageGeometry } from "../model/parse/index.js";
import { resplitColumns } from "../model/parse/resplit.js";
import { selectBlocks, tableGrid } from "../model/parse-schema.js";
import { toCSV, toMarkdown } from "../model/parse-to-text.js";
import { imageKey } from "../host/parse-store.js";
import { parsedDocTitle } from "../model/pdf.js";
import { loadPageData, readScan } from "./parse-engine.js";
import { scanPagesOf } from "../model/parse/ocr-merge.js";
import { createParseOverlay } from "./parse-overlay.js";
import { createPageChips, runChipAction } from "./page-chips.js";
import { cropRect, createCropQueue } from "./parse-crop.js";
import { makeHighlight } from "./make-highlight.js";
import { isTextEntryTarget } from "./cards.js";
import { createDragGhost, dispatchDrop } from "./drag-ghost.js";

export const PARSE_MIME = "application/x-plexus-parse";
export const BUILTIN_OPTIONS = Object.freeze({ ocr: "none", formula: false, tables: "builtin" });
export const SYNC_MS = 250;
export const LOW_CONFIDENCE = 0.75;
export const BOTH_MIN_PX = 640;
const URLS_KEY = "pxd-parse-urls";
const TEXT_TYPES = new Set(["heading", "para", "list", "caption", "footnote", "code"]);
const INDEX_TYPES = new Set(["heading", "table", "figure", "formula"]);

function reasonLabel(reason) {
  if (reason === "page-number") return "page numbers";
  if (reason === "running-header" || reason === "header") return "running header";
  if (reason === "running-footer" || reason === "footer") return "running footer";
  return String(reason || "furniture").replace(/-/g, " ");
}

export function removedSummary(removed) {
  const counts = new Map();
  for (const row of removed || []) {
    const label = reasonLabel(row?.reason);
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  if (!counts.size) return "";
  const parts = [...counts].map(([label, n]) => `${label} (${n})`);
  return `Removed: ${parts.join(" · ")}`;
}

export function formatSeconds(ms) {
  const s = Math.max(0, Number(ms) || 0) / 1000;
  const text = s < 10 ? s.toFixed(1) : String(Math.round(s));
  return `${text} s`;
}

// All when the document is short or the count is not known yet. Current page past 60.
export function defaultRangeChoice(pageCount) {
  const n = Number(pageCount);
  if (!Number.isFinite(n) || n <= 0 || n <= 60) return "all";
  return "current";
}

export function engineChip({ phase = "idle", engine = "builtin", ms = null, page = 0, pageCount = 0, helper = "" } = {}) {
  if (phase === "running") {
    const which = engine === "docling" ? "Docling" : "built-in";
    return { text: `Page ${page} of ${pageCount}`, cancel: true, detail: which };
  }
  if (helper === "not-running" || helper === "disabled") {
    return { text: "Local helper: off", tip: "Open Engines (the gear) to set up or start the local helper." };
  }
  if (helper === "wrong-token") return { text: "Local helper: wrong token", tip: "Open Engines (the gear) and pair the local helper again." };
  if (helper === "models-missing") return { text: "Local helper: downloading models", tip: "The helper is downloading models." };
  if (helper === "newer-schema") return { text: "Local helper: newer schema", tip: "This Plexus is older than the helper." };
  if ((engine === "docling" || engine === "mixed") && ms != null) return { text: `Docling · ${formatSeconds(ms)}` };
  if (ms != null) return { text: `Built-in · ${formatSeconds(ms)}` };
  return { text: "Built-in" };
}

export function blockGroup(type) {
  if (type === "table") return "table";
  if (type === "figure") return "figure";
  if (type === "formula") return "formula";
  if (type === "scan") return "scan";
  return "text";
}

export function visibleBlocks(doc, { filters, query, range } = {}) {
  const on = filters || { text: true, table: true, figure: true, formula: true };
  const needle = String(query || "").trim().toLowerCase();
  let blocks = selectBlocks(doc, range || null);
  if (Array.isArray(range) && range.length === 2 && range.every((n) => typeof n === "number")) {
    blocks = selectBlocks(doc, range);
  }
  return blocks.filter((block) => {
    const group = blockGroup(block.type);
    if (group === "scan") return false;
    if (on[group] === false) return false;
    if (!needle) return true;
    return haystack(block).includes(needle);
  });
}

function haystack(block) {
  const parts = [block.text, block.latex, block.number];
  for (const item of block.items || []) parts.push(item.text, item.marker);
  for (const cell of block.cells || []) parts.push(cell.text);
  return parts.filter(Boolean).join(" ").toLowerCase();
}

export function copyText(doc, ids, { shift = false } = {}) {
  const blocks = selectBlocks(doc, ids);
  const tables = blocks.filter((block) => block.type === "table");
  if ((shift && tables.length) || (blocks.length === 1 && blocks[0]?.type === "table")) {
    return { format: "csv", text: tables.map((table) => toCSV(table)).join("\r\n\r\n") };
  }
  return { format: "md", text: toMarkdown(doc, ids) };
}

export function dragPayload({ sha256 = "", engine = "builtin", optsHash = "", ids = [], pdfUid = "", kind = "blocks" } = {}) {
  return { sha256, engine, optsHash, ids: ids.slice(), pdfUid, kind };
}

export function syncDecision({ locked = false, wheeling = false, now = 0, last = null, throttle = SYNC_MS } = {}) {
  if (locked || wheeling) return { jump: false, last };
  if (last != null && now - last < throttle) return { jump: false, last };
  return { jump: true, last: now };
}

export function keyCommand(event, { textEntry = false, owned = false } = {}) {
  if (!owned || textEntry || !event) return null;
  const key = event.key;
  const meta = Boolean(event.metaKey || event.ctrlKey);
  if (key === "ArrowDown") return event.shiftKey ? "extend-next" : "next";
  if (key === "ArrowUp") return event.shiftKey ? "extend-prev" : "prev";
  if (key === " ") return "toggle";
  if (key === "Enter" && meta) return "send";
  if (key === "Enter") return "locate";
  if ((key === "c" || key === "C") && meta) return "copy";
  if (key === "i" || key === "I") return "insert";
  if (key === "h" || key === "H") return "highlight";
  if (key === "d" || key === "D") return "docling-table";
  if (key === "[") return "prev-table";
  if (key === "]") return "next-table";
  if (key === "/") return "search";
  if (key === "Escape") return "clear";
  return null;
}

export function parseOwnsKey(event, root, pointerTarget) {
  if (!root) return false;
  const active = root.ownerDocument?.activeElement || null;
  if (isTextEntryTarget(event?.target) || isTextEntryTarget(active)) return false;
  if (active && root.contains?.(active)) return true;
  if (event?.target && root.contains?.(event.target)) return true;
  if (pointerTarget && root.contains?.(pointerTarget)) return true;
  return false;
}

export function readParsedUrls(storage) {
  try {
    const raw = storage?.getItem?.(URLS_KEY);
    const list = JSON.parse(raw || "[]");
    return new Set(Array.isArray(list) ? list.filter((url) => typeof url === "string" && url) : []);
  } catch {
    return new Set();
  }
}

export function rememberParsedUrl(storage, url) {
  if (!url || !storage?.setItem) return;
  const urls = readParsedUrls(storage);
  urls.delete(url);
  const next = [url, ...urls].slice(0, 50);
  try { storage.setItem(URLS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
}

export function tableChipLabel(table) {
  if (!table) return "";
  if (table.method === "tableformer") return "TableFormer";
  const method = table.method || "table";
  const conf = typeof table.confidence === "number" ? table.confidence.toFixed(2) : "";
  return conf ? `${method} · ${conf}` : method;
}

export function scanPageNumbers(doc) {
  const pages = (doc?.pages || []).filter((page) => page.kind === "scan").map((page) => page.n);
  const blocks = selectBlocks(doc, null).filter((block) => block.type === "scan").map((block) => block.page);
  return [...new Set([...pages, ...blocks])].sort((a, b) => a - b);
}

// U6. Never a bare message: the scanned-page note always comes with a Read text button (onNeedOcr).
export function scanSpan(doc) {
  const nums = scanPageNumbers(doc);
  if (!nums.length) return "";
  const from = nums[0];
  const to = nums[nums.length - 1];
  const label = from === to ? `Scanned page ${from}` : `Scanned pages ${from}–${to}`;
  return `${label} · the page is an image`;
}

// U6. Outline rows: headings, tables, figures and formulas. A heading stands for its section: itself and
// the blocks after it up to the next heading of the same or a higher level.
export function outlineBlocks(blocks) {
  return (blocks || []).filter((block) => INDEX_TYPES.has(block?.type));
}

export function sectionIds(doc, headingId) {
  const all = selectBlocks(doc, null);
  const at = all.findIndex((block) => block.id === headingId);
  if (at < 0) return [];
  const head = all[at];
  if (head.type !== "heading") return [head.id];
  const level = head.level || 1;
  const out = [head.id];
  for (let i = at + 1; i < all.length; i += 1) {
    const block = all[i];
    if (block.type === "heading" && (block.level || 1) <= level) break;
    if (block.type === "scan") continue;
    out.push(block.id);
  }
  return out;
}

export function outlineLabel(block) {
  if (!block) return "";
  if (block.type === "table") {
    const size = block.rows && block.cols ? ` ${block.rows}×${block.cols}` : "";
    return `Table${size}${block.caption ? ` · ${block.caption}` : ""}`;
  }
  if (block.type === "figure") return `Figure${block.text ? ` · ${block.text}` : ""}`;
  if (block.type === "formula") return `Formula${block.latex ? ` · ${block.latex}` : ""}`;
  return String(block.text || "");
}

function setHidden(node, on) {
  if (!node) return;
  node.hidden = Boolean(on);
  if (on) node.setAttribute("hidden", "");
  else node.removeAttribute("hidden");
}

function kindOf(blocks) {
  if (blocks.length === 1 && blocks[0].type === "table") return "table";
  if (blocks.length === 1 && (blocks[0].type === "figure" || blocks[0].type === "formula")) return blocks[0].type;
  return "blocks";
}

function wordsFromTable(table) {
  const words = [];
  for (const cell of table?.cells || []) {
    const box = cell.bbox;
    if (!Array.isArray(box)) continue;
    const size = Math.max(8, (box[3] - box[1]) * 0.6);
    words.push({ x0: box[0], x1: box[2], base: box[3] - size * 0.2, size, text: cell.text || "" });
  }
  return words;
}

function emptyGeometry(n) {
  return {
    n,
    w: 612,
    h: 792,
    rotation: 0,
    kind: "text",
    lines: [],
    rotated: [],
    words: [],
    graphics: { dots: [], rules: [], boxes: [], images: [] },
    tables: [],
    figures: [],
    used: new Set(),
    ms: 0,
  };
}

export function createParseView({
  doc = globalThis.document,
  store = null,
  helper = null,
  session = null,
  host = null,
  storage = null,
  pdfUid = "",
  url = "",
  getPdf = null,
  loadGeometry = null,
  jumpPage = null,
  pageNow = null,
  pageEl = null,
  pageOf = null,
  readerEl = null,
  writeText = null,
  onToast = null,
  onCached = null,
  onTitle = null,
  onProgress = null,
  adoptCreated = null,
  getContext = null,
  clock = null,
  scanAuto = false,
  outline = false,
  onNeedOcr = null,
  onScan = null,
  onOcrPages = null,
  ghostRoot = null,
  ghostPane = null,
} = {}) {
  const el = (tag, cls, parent) => {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    parent?.append?.(node);
    return node;
  };
  const now = () => (typeof clock === "function" ? clock() : Date.now());
  const root = el("div", "pxd-parse");
  root.tabIndex = -1;
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", "Parsed PDF");
  const bar = el("div", "pxd-parse__bar", root);
  const engineMenu = el("div", "pxd-parse__menu", bar);
  const chip = el("button", "pxd-parse__engine", engineMenu);
  chip.type = "button";
  chip.textContent = "Built-in";
  chip.setAttribute("aria-haspopup", "menu");
  const enginePop = el("div", "pxd-parse__pop", engineMenu);
  enginePop.setAttribute("role", "menu");
  setHidden(enginePop, true);
  const againBtn = el("button", "pxd-parse__again", enginePop);
  againBtn.type = "button";
  againBtn.textContent = "Parse again (built-in)";
  const doclingBtn = el("button", "pxd-parse__docling", enginePop);
  doclingBtn.type = "button";
  doclingBtn.textContent = "Parse with Docling";
  doclingBtn.setAttribute("data-tip", "parse.docling");
  setHidden(doclingBtn, true);
  const cancelBtn = el("button", "pxd-parse__cancel", enginePop);
  cancelBtn.type = "button";
  cancelBtn.textContent = "Cancel";
  cancelBtn.setAttribute("data-tip", "parse.cancel");
  setHidden(cancelBtn, true);
  const rangeMenu = el("div", "pxd-parse__menu", bar);
  const rangeBtn = el("button", "pxd-parse__rangebtn", rangeMenu);
  rangeBtn.type = "button";
  rangeBtn.textContent = "All";
  rangeBtn.setAttribute("aria-label", "Page range");
  rangeBtn.setAttribute("aria-haspopup", "menu");
  const rangePop = el("div", "pxd-parse__pop", rangeMenu);
  rangePop.setAttribute("role", "menu");
  setHidden(rangePop, true);
  const currentBtn = el("button", "pxd-parse__chip", rangePop);
  currentBtn.type = "button";
  currentBtn.textContent = "Current page";
  currentBtn.setAttribute("data-range", "current");
  const allBtn = el("button", "pxd-parse__chip", rangePop);
  allBtn.type = "button";
  allBtn.textContent = "All";
  allBtn.setAttribute("data-range", "all");
  allBtn.setAttribute("aria-pressed", "true");
  const rangeInput = el("input", "pxd-parse__range", rangePop);
  rangeInput.type = "text";
  rangeInput.value = "";
  rangeInput.placeholder = "3-7";
  rangeInput.setAttribute("aria-label", "Page range");
  rangeInput.setAttribute("data-tip", "parse.range");
  const filterMenu = el("div", "pxd-parse__menu", bar);
  const filterBtn = el("button", "pxd-parse__filterbtn", filterMenu);
  filterBtn.type = "button";
  filterBtn.textContent = "Filter";
  filterBtn.setAttribute("aria-haspopup", "menu");
  filterBtn.setAttribute("aria-label", "Filter blocks");
  const filterPop = el("div", "pxd-parse__pop", filterMenu);
  filterPop.setAttribute("role", "menu");
  setHidden(filterPop, true);
  // Scanned pages (image only, or an old OCR text layer): OCR through the helper, then the
  // built-in engine. Shown only when the parse has such pages and the helper is ready.
  const scanBtn = el("button", "pxd-parse__scan", bar);
  scanBtn.type = "button";
  scanBtn.textContent = "Read the scan";
  scanBtn.hidden = true;
  const filters = { text: true, table: true, figure: true, formula: true };
  const filterBtns = {};
  for (const name of ["Text", "Tables", "Figures", "Formulas"]) {
    const key = name === "Tables" ? "table" : name === "Figures" ? "figure" : name === "Formulas" ? "formula" : "text";
    const button = el("button", "pxd-parse__filter", filterPop);
    button.type = "button";
    button.textContent = name;
    button.setAttribute("aria-pressed", "true");
    button.setAttribute("data-filter", key);
    filterBtns[key] = button;
  }
  const searchBtn = el("button", "pxd-parse__searchbtn", bar);
  searchBtn.type = "button";
  searchBtn.textContent = "⌕";
  searchBtn.setAttribute("aria-label", "Search");
  searchBtn.setAttribute("data-tip", "parse.search");
  const search = el("input", "pxd-parse__search", bar);
  search.type = "search";
  search.placeholder = "Search";
  search.setAttribute("aria-label", "Search parsed text");
  search.setAttribute("data-tip", "parse.search");
  setHidden(search, true);
  const lockBtn = el("button", "pxd-parse__lock", bar);
  lockBtn.type = "button";
  lockBtn.textContent = "⇅";
  lockBtn.setAttribute("aria-label", "Sync scroll");
  lockBtn.setAttribute("aria-pressed", "true");
  lockBtn.setAttribute("data-tip", "parse.sync");
  const track = el("div", "pxd-parse__track", root);
  const fill = el("div", "pxd-parse__fill", track);
  setHidden(track, true);
  const body = el("div", "pxd-parse__body", root);
  body.tabIndex = 0;
  const empty = el("div", "pxd-parse__empty", body);
  empty.textContent = "No parse yet · Parse (built-in)";
  const parseBtn = el("button", "pxd-parse__go", empty);
  parseBtn.type = "button";
  parseBtn.textContent = "Parse (built-in)";
  const foot = el("div", "pxd-parse__foot", root);
  setHidden(foot, true);
  const summary = el("span", "pxd-parse__summary", foot);
  const copyBtn = el("button", "pxd-parse__act", foot);
  copyBtn.type = "button";
  copyBtn.textContent = "Copy";
  copyBtn.setAttribute("data-tip", "parse.copy");
  const insertBtn = el("button", "pxd-parse__act", foot);
  insertBtn.type = "button";
  insertBtn.textContent = "Insert below PDF";
  insertBtn.setAttribute("data-tip", "parse.insert");
  const sendBtn = el("button", "pxd-parse__act", foot);
  sendBtn.type = "button";
  sendBtn.textContent = "Send to board";
  sendBtn.setAttribute("data-tip", "parse.send");
  const hlBtn = el("button", "pxd-parse__act", foot);
  hlBtn.type = "button";
  hlBtn.textContent = "Make highlight";
  hlBtn.setAttribute("data-tip", "parse.highlight");
  const tableMenu = el("details", "pxd-parse__insert", foot);
  const tableSum = el("summary", "", tableMenu);
  tableSum.textContent = "Insert table";
  for (const [mode, label] of [["grid", "Roam Grid"], ["native", "Native"], ["flat", "Flat"]]) {
    const button = el("button", "pxd-parse__act", tableMenu);
    button.type = "button";
    button.textContent = label;
    button.setAttribute("data-mode", mode);
  }

  let currentUrl = url || "";
  let currentUid = pdfUid || "";
  let parsed = null;
  let records = [];
  let query = "";
  let range = null;
  let rangeLabel = "All";
  let rangeTouched = false;
  let selected = [];
  let anchor = -1;
  let focusId = "";
  let pointerTarget = null;
  let locked = false;
  let wheelingUntil = 0;
  let lastJump = null;
  let echo = false;
  let abort = null;
  let jobId = "";
  let helperState = "";
  let phase = "idle";
  let dead = false;
  let progress = { page: 0, pageCount: 0, engine: "builtin" };
  let keyFn = null;
  let wheelFn = null;
  const armed = [];
  const blockArmed = [];

  const listen = (node, type, fn, capture = false) => {
    if (!node || typeof node.addEventListener !== "function") return;
    node.addEventListener(type, fn, capture);
    armed.push([node, type, fn, capture]);
  };
  const clearBlockListeners = () => {
    for (const [node, type, fn, capture] of blockArmed) {
      try { node?.removeEventListener?.(type, fn, capture); } catch { /* gone */ }
    }
    blockArmed.length = 0;
  };
  const listenBlock = (node, type, fn, capture = false) => {
    if (!node || typeof node.addEventListener !== "function") return;
    node.addEventListener(type, fn, capture);
    blockArmed.push([node, type, fn, capture]);
  };

  const overlay = createParseOverlay({
    doc,
    pageEl: (n) => pageEl?.(n) || null,
    pageOf: (n) => pageInfo(n),
    onResplit: (table, xs) => { void commitResplit(table, xs); },
  });

  function pageInfo(n) {
    const fromDoc = (parsed?.pages || []).find((page) => page.n === n);
    const given = pageOf?.(n);
    return { w: fromDoc?.w || given?.w || 612, h: fromDoc?.h || given?.h || 792, rotation: fromDoc?.rotation || given?.rotation || 0, ...(given || {}) };
  }

  function shown() {
    const blocks = visibleBlocks(parsed, { filters, query, range });
    return outline && !String(query || "").trim() ? outlineBlocks(blocks) : blocks;
  }

  // Outline headings stand for their sections when inserting, sending, copying or dragging.
  function expand(blocks) {
    if (!outline || !parsed) return blocks;
    const ids = [];
    for (const block of blocks || []) {
      for (const id of block.type === "heading" ? sectionIds(parsed, block.id) : [block.id]) if (!ids.includes(id)) ids.push(id);
    }
    return selectBlocks(parsed, ids);
  }

  const pageChips = createPageChips({
    doc,
    host: readerEl || null,
    getParsed: () => parsed,
    pageEl: (n) => pageEl?.(n) || null,
    pageOf: (n) => pageInfo(n),
    isLatexReady: () => helperState === "ready",
    run: (act, item) => {
      runChipAction({ act, ...item }, {
        session,
        payload: (ids) => payload(ids.map((id) => parsed?.blocks?.[id]).filter(Boolean)),
        copy: (ids) => { if (parsed) void writeClipboard(copyText(parsed, ids, { shift: false }).text); },
        latex: (block) => {
          if (block?.latex) void writeClipboard(`$$${block.latex}$$`);
          else onToast?.("Run Docling on this page to read the formula as LaTeX");
        },
      });
    },
  });

  function idsOf(blocks) {
    return (blocks || shown()).map((block) => block.id);
  }

  function payload(blocks) {
    const list = expand(blocks || shown().filter((block) => selected.includes(block.id)));
    return dragPayload({
      sha256: parsed?.sha256 || "",
      engine: parsed?.engine || "builtin",
      optsHash: parsed?.optsHash || "",
      ids: list.map((block) => block.id),
      pdfUid: currentUid,
      kind: kindOf(list),
    });
  }

  function paintChip() {
    const state = engineChip({
      phase,
      engine: progress.engine || parsed?.engine || "builtin",
      ms: phase === "running" ? null : parsed?.stats?.ms,
      page: progress.page,
      pageCount: progress.pageCount,
      helper: phase === "running" ? "" : helperState,
    });
    chip.textContent = state.text;
    chip.title = state.tip || "";
    if (state.tip) chip.setAttribute("data-tip-extra", state.tip);
    else chip.removeAttribute("data-tip-extra");
    const tipId = phase === "running" ? "parse.cancel"
      : helperState === "wrong-token" ? "parse.docling-token"
        : helperState === "models-missing" ? "parse.docling-models"
          : (helperState === "not-running" || helperState === "disabled") ? "parse.docling-off"
            : "parse.chip";
    chip.setAttribute("data-tip", tipId);
    const running = phase === "running";
    setHidden(cancelBtn, !running);
    setHidden(doclingBtn, helperState !== "ready");
    setHidden(track, !running);
    const denom = Number(progress.pageCount) || 0;
    const frac = running && denom ? Math.max(0, Math.min(1, Number(progress.page) / denom)) : 0;
    fill.style.width = `${Math.round(frac * 100)}%`;
  }

  function paintFoot() {
    const blocks = shown().filter((block) => selected.includes(block.id));
    setHidden(foot, blocks.length === 0);
    const tables = blocks.filter((block) => block.type === "table").length;
    const rest = blocks.length - tables;
    const bits = [];
    if (rest) bits.push(`${rest} block${rest === 1 ? "" : "s"}`);
    if (tables) bits.push(`${tables} table${tables === 1 ? "" : "s"}`);
    summary.textContent = bits.join(" · ");
    const textish = blocks.some((block) => TEXT_TYPES.has(block.type));
    setHidden(hlBtn, !textish);
    setHidden(tableMenu, tables === 0);
  }

  function renderTable(table, parent) {
    const grid = tableGrid(table);
    const node = el("table", "pxd-parse__table", parent);
    for (const row of grid) {
      const tr = el("tr", "", node);
      for (const slot of row) {
        if (slot.covered) continue;
        const cell = slot.cell;
        const tag = cell?.header ? "th" : "td";
        const td = el(tag, cell?.align === "right" || cell?.numeric ? "pxd-parse__num" : "", tr);
        if ((cell?.rowSpan ?? 1) > 1) td.setAttribute("rowspan", String(cell.rowSpan));
        if ((cell?.colSpan ?? 1) > 1) td.setAttribute("colspan", String(cell.colSpan));
        td.textContent = cell ? String(cell.text ?? "") : "";
      }
    }
    return node;
  }

  function renderOutlineRow(block, main) {
    const label = el(block.type === "heading" ? "div" : "div", `pxd-parse__olabel pxd-parse__olabel--${block.type}`, main);
    label.textContent = outlineLabel(block);
    if (block.type === "heading") label.style.paddingLeft = `${Math.max(0, (Math.min(6, block.level || 1) - 1) * 12)}px`;
    const page = el("span", "pxd-parse__opage", main);
    page.textContent = block.page ? `p. ${block.page}` : "";
  }

  function renderBlock(block, parent) {
    const row = el("article", "pxd-parse__block", parent);
    row.tabIndex = 0;
    row.setAttribute("data-id", block.id);
    row.setAttribute("data-type", block.type);
    row.setAttribute("data-page", String(block.page ?? ""));
    if (typeof block.confidence === "number" && block.confidence < LOW_CONFIDENCE) row.classList.add("pxd-parse__block--low");
    if (selected.includes(block.id)) row.classList.add("pxd-parse__block--on");
    if (focusId === block.id) row.classList.add("pxd-parse__block--focus");
    const gutter = el("div", "pxd-parse__gutter", row);
    const handle = el("button", "pxd-parse__handle", gutter);
    handle.type = "button";
    handle.textContent = "⋮⋮";
    handle.draggable = true;
    handle.setAttribute("aria-label", "Drag");
    const check = el("input", "pxd-parse__check", gutter);
    check.type = "checkbox";
    check.checked = selected.includes(block.id);
    check.setAttribute("aria-label", "Select");
    const main = el("div", "pxd-parse__main", row);
    if (outline && !String(query || "").trim()) {
      row.classList.add("pxd-parse__orow");
      renderOutlineRow(block, main);
    } else if (block.type === "heading") {
      const level = Math.min(6, Math.max(1, block.level || 1));
      const heading = el(`h${level}`, "pxd-parse__h", main);
      heading.textContent = block.text || "";
    } else if (block.type === "list") {
      const list = el(block.ordered ? "ol" : "ul", "pxd-parse__list", main);
      for (const item of block.items || []) {
        const li = el("li", "", list);
        li.textContent = item.text || "";
        if (item.level) li.style.marginLeft = `${item.level * 16}px`;
      }
    } else if (block.type === "table") {
      renderTable(block, main);
      const menu = el("details", "pxd-parse__tmenu", main);
      const sum = el("summary", "pxd-parse__tchip", menu);
      sum.textContent = tableChipLabel(block);
      const again = el("button", "pxd-parse__act", menu);
      again.type = "button";
      again.textContent = "Re-parse with Docling";
      listenBlock(again, "click", (event) => { event.stopPropagation?.(); void reparseTable(block); });
    } else if (block.type === "formula") {
      if (block.latex) {
        const math = el("div", "pxd-parse__math", main);
        try {
          if (typeof host?.renderString === "function") host.renderString(math, `$$${block.latex}$$`);
          else math.textContent = block.latex;
        } catch {
          math.textContent = block.latex;
        }
        if (!math.textContent && !math.childElementCount) {
          const code = el("code", "pxd-parse__code", math);
          code.textContent = block.latex;
        }
      } else {
        const img = el("img", "pxd-parse__crop", main);
        img.alt = block.text || "Formula";
        void paintCrop(block, img);
      }
    } else if (block.type === "figure") {
      const img = el("img", "pxd-parse__crop", main);
      img.alt = block.text || "Figure";
      void paintCrop(block, img);
    } else if (block.type === "code") {
      const code = el("code", "pxd-parse__code", main);
      code.textContent = block.text || "";
    } else {
      const p = el("p", "pxd-parse__p", main);
      p.textContent = block.text || "";
    }
    listenBlock(handle, "dragstart", (event) => beginDrag(event, [block]));
    listenBlock(handle, "pointerdown", (event) => beginPointerDrag(event, [block]));
    return row;
  }

  function needOcr() {
    const pages = parsed ? scanPagesOf(parsed) : [];
    if (typeof onNeedOcr === "function") {
      try { onNeedOcr({ pages: pages.length ? pages : scanPageNumbers(parsed), readScan: readScanNow, helperState }); } catch { /* host */ }
      return;
    }
    void (async () => {
      await refreshHelper();
      if (helperState === "ready") await readScanNow();
      else { try { onToast?.("Scanned page: start the local helper to read its text (Settings → Parse)"); } catch { /* host */ } }
    })();
  }

  function render() {
    if (dead) return;
    clearBlockListeners();
    const blocks = shown();
    body.replaceChildren?.();
    if (parsed) { try { onTitle?.(parsedDocTitle(parsed)); } catch { /* host */ } }
    if (parsed && typeof onScan === "function") {
      const scanned = scanPagesOf(parsed);
      try { onScan({ pages: scanned.length ? scanned : scanPageNumbers(parsed), readScan: readScanNow, helperState }); } catch { /* host */ }
    }
    if (!parsed) {
      body.append(empty);
      empty.textContent = "";
      empty.append(parseBtn);
      const lead = el("div", "pxd-parse__lead", empty);
      lead.textContent = "No parse yet · Parse (built-in)";
      paintFoot();
      paintChip();
      return;
    }
    if (!blocks.length) {
      const note = el("div", "pxd-parse__empty", body);
      const scan = scanSpan(parsed);
      const filtered = Boolean(query) || Object.values(filters).some((on) => !on);
      if (scan && !filtered) {
        el("span", "pxd-parse__scantext", note).textContent = scan;
        const read = el("button", "pxd-parse__readtext", note);
        read.type = "button";
        read.textContent = "Read text";
        read.setAttribute("data-tip", "parse.read-text");
        listenBlock(read, "click", (event) => { event.stopPropagation?.(); needOcr(); });
      }
      else if (!filtered && (helperState === "not-running" || helperState === "disabled")) note.textContent = "Local helper is off · open Engines (the gear) to start it";
      else note.textContent = "Nothing matches";
    }
    let page = null;
    for (const block of blocks) {
      if (block.page !== page) {
        page = block.page;
        const divider = el("div", "pxd-parse__page", body);
        divider.textContent = `p. ${page}`;
        divider.setAttribute("data-page", String(page));
      }
      renderBlock(block, body);
    }
    const removed = removedSummary(parsed.removed);
    if (removed) {
      const box = el("details", "pxd-parse__removed", body);
      const sum = el("summary", "", box);
      sum.textContent = removed;
      for (const row of parsed.removed || []) {
        const line = el("div", "pxd-parse__removedrow", box);
        line.textContent = row.text || "";
      }
    }
    paintFoot();
    paintChip();
    paintScan();
  }

  function indexOfId(id) {
    return shown().findIndex((block) => block.id === id);
  }

  function selectIds(ids, { focus = null } = {}) {
    selected = ids.slice();
    if (focus) focusId = focus;
    render();
    const node = body.querySelector?.(`[data-id="${focusId}"]`);
    try { node?.focus?.(); } catch { /* stub */ }
  }

  function move(delta, extend) {
    const blocks = shown();
    if (!blocks.length) return;
    let index = indexOfId(focusId);
    if (index < 0) index = delta > 0 ? -1 : 0;
    const next = Math.max(0, Math.min(blocks.length - 1, index + delta));
    focusId = blocks[next].id;
    if (anchor < 0) anchor = index < 0 ? next : index;
    if (extend) {
      const from = Math.min(anchor, next);
      const to = Math.max(anchor, next);
      selected = blocks.slice(from, to + 1).map((block) => block.id);
    } else {
      anchor = next;
      selected = [focusId];
    }
    render();
    try { body.querySelector?.(`[data-id="${focusId}"]`)?.focus?.(); } catch { /* stub */ }
  }

  function locate(block) {
    if (!block) return;
    try { jumpPage?.(block.page); } catch { /* reader */ }
    const info = pageInfo(block.page);
    overlay.flash({ ...block, bbox: block.bbox });
    void info;
  }

  async function writeClipboard(text) {
    if (typeof writeText === "function") { await writeText(text); return; }
    try { await doc.defaultView?.navigator?.clipboard?.writeText?.(text); } catch { /* clipboard */ }
  }

  async function copySelection(shift) {
    const picked = selected.length ? selected : (focusId ? [focusId] : []);
    if (!picked.length || !parsed) return;
    const ids = expand(selectBlocks(parsed, picked)).map((block) => block.id);
    const result = copyText(parsed, ids, { shift });
    await writeClipboard(result.text);
  }

  function callSession(name, extra) {
    const fn = session?.[name];
    if (typeof fn !== "function") return false;
    const blocks = shown().filter((block) => selected.includes(block.id));
    const bodyPayload = payload(blocks.length ? blocks : shown().filter((block) => block.id === focusId));
    try { fn(extra ? { ...bodyPayload, ...extra } : bodyPayload); } catch { /* host */ }
    return true;
  }

  function insertSelection() {
    const blocks = shown().filter((block) => selected.includes(block.id));
    const kind = kindOf(expand(blocks.length ? blocks : shown().filter((block) => block.id === focusId)));
    if ((kind === "figure" || kind === "formula") && callSession("insertParsedCard")) return true;
    return callSession("insertParsedBelow");
  }

  function beginDrag(event, blocks) {
    const data = event.dataTransfer;
    const json = JSON.stringify(payload(blocks));
    if (data && typeof data.setData === "function") {
      data.setData(PARSE_MIME, json);
      try { data.setData("text/plain", json); } catch { /* second type */ }
      try { data.effectAllowed = "copy"; } catch { /* read only */ }
    }
    event.stopPropagation?.();
  }

  function ghostSource(blocks) {
    const list = expand(blocks);
    if (list.length === 1 && list[0].type === "table") {
      const rows = tableGrid(list[0]).slice(0, 3).map((row) => row.filter((slot) => !slot.covered).map((slot) => slot.cell?.text ?? ""));
      return { kind: "table", rows, page: list[0].page };
    }
    const text = list.map((block) => (block.type === "list" ? (block.items || []).map((item) => item.text).join(" ") : block.text || block.latex || "")).join(" ");
    const kind = list.length === 1 && list[0].type === "figure" ? "figure" : "blocks";
    return { kind, text, page: list[0]?.page };
  }

  // U5. The handle drags a card-shaped ghost; the drop lands at the ghost's top-left.
  function beginPointerDrag(event, blocks) {
    if (event.button != null && event.button !== 0) return;
    const startX = Number(event.clientX) || 0;
    const startY = Number(event.clientY) || 0;
    const rowEl = event.target?.closest?.(".pxd-parse__block") || null;
    let moved = false;
    let ghost = null;
    const win = doc.defaultView || doc;
    const drop = (x, y, at) => {
      const json = JSON.stringify(payload(blocks));
      if (!doc.elementFromPoint) return;
      dispatchDrop({ doc, root: ghostRoot, pointer: { x, y }, at, entries: [[PARSE_MIME, json], ["text/plain", json]] });
    };
    const finish = () => {
      win?.removeEventListener?.("pointermove", move, true);
      win?.removeEventListener?.("pointerup", up, true);
      win?.removeEventListener?.("keydown", key, true);
      win?.removeEventListener?.("dragstart", native, true);
      win?.removeEventListener?.("pointercancel", cancelled, true);
      for (const fn of [move, up, key, native, cancelled]) {
        const idx = armed.findIndex((entry) => entry[2] === fn);
        if (idx >= 0) armed.splice(idx, 1);
      }
    };
    const move = (ev) => {
      const x = Number(ev.clientX) || 0;
      const y = Number(ev.clientY) || 0;
      if (!moved && Math.abs(x - startX) + Math.abs(y - startY) > 4) {
        moved = true;
        if (ghostRoot) {
          let from = null;
          try { from = rowEl?.getBoundingClientRect?.() || null; } catch { from = null; }
          ghost = createDragGhost({ doc, root: ghostRoot, pane: ghostPane, from, pointer: { x: startX, y: startY }, content: ghostSource(blocks) });
        }
      }
      ghost?.move(x, y);
    };
    // The handle is also a native drag source. Once the ghost runs it owns the drag; before that the
    // browser's drag wins and this press ends.
    const native = (ev) => {
      if (ghost) { ev.preventDefault?.(); return; }
      finish();
    };
    const cancelled = () => {
      finish();
      ghost?.cancel();
      ghost = null;
    };
    const key = (ev) => {
      if (ev.key !== "Escape") return;
      ev.stopPropagation?.();
      finish();
      ghost?.cancel();
      ghost = null;
    };
    const up = (ev) => {
      finish();
      if (!moved) return;
      const x = Number(ev.clientX) || 0;
      const y = Number(ev.clientY) || 0;
      ghost?.move(x, y);
      const at = ghost && ghost.zone() === "board" ? ghost.dropPoint() : { x, y };
      drop(x, y, at);
      ghost?.land();
      ghost = null;
    };
    listen(win, "pointermove", move, true);
    listen(win, "pointerup", up, true);
    listen(win, "keydown", key, true);
    listen(win, "dragstart", native, true);
    listen(win, "pointercancel", cancelled, true);
  }

  function wordsFor(table) {
    const rec = records.find((row) => row.n === table.page);
    if (rec?.words?.length) return rec.words;
    return wordsFromTable(table);
  }

  async function commitResplit(table, xs) {
    if (!parsed?.blocks?.[table.id]) return;
    const next = resplitColumns(table, wordsFor(table), xs);
    next.confidence = 1;
    next.edited = true;
    parsed = { ...parsed, blocks: { ...parsed.blocks, [table.id]: { ...next, id: table.id, type: "table", page: table.page } } };
    try { await store?.putParse?.(parsed); } catch { /* cache */ }
    render();
    overlay.showGrid(parsed.blocks[table.id]);
  }

  function imageSrc(cached) {
    if (typeof cached === "string" && cached) return cached;
    return "";
  }

  async function cropAt2x(block) {
    const box = block?.bbox;
    if (!Array.isArray(box) || box.length < 4) return "";
    const pdf = typeof getPdf === "function" ? await getPdf() : null;
    if (!pdf || typeof pdf.getPage !== "function") return "";
    let page = null;
    try { page = await pdf.getPage(block.page); } catch { return ""; }
    if (!page || typeof page.getViewport !== "function" || typeof page.render !== "function") return "";
    const canvas = doc.createElement?.("canvas");
    const ctx = canvas?.getContext?.("2d");
    if (!ctx || typeof canvas.toDataURL !== "function") return "";
    const scale = 2;
    let viewport = null;
    try { viewport = page.getViewport({ scale }); } catch { return ""; }
    const info = pageInfo(block.page);
    const rect = cropRect(box, info.w, info.h, viewport?.width, viewport?.height);
    if (!rect) return "";
    const { left, top } = rect;
    canvas.width = rect.width;
    canvas.height = rect.height;
    try {
      const task = page.render({ canvasContext: ctx, viewport, transform: [1, 0, 0, 1, -left, -top] });
      if (task?.promise) await task.promise;
      return canvas.toDataURL("image/png") || "";
    } catch {
      return "";
    }
  }

  const cropQueue = createCropQueue(2);
  let cropObserver = null;
  const cropWaiting = new Map();
  function paintCrop(block, img) {
    img.setAttribute("data-crop", "pending");
    const run = () => cropQueue.add(() => paintCropNow(block, img));
    const IO = doc.defaultView?.IntersectionObserver;
    if (typeof IO !== "function") return run();
    if (!cropObserver) {
      cropObserver = new IO((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const go = cropWaiting.get(entry.target);
          cropWaiting.delete(entry.target);
          try { cropObserver?.unobserve(entry.target); } catch { /* gone */ }
          go?.();
        }
      });
    }
    cropWaiting.set(img, run);
    cropObserver.observe(img);
    return Promise.resolve();
  }

  async function paintCropNow(block, img) {
    const key = parsed?.sha256 ? imageKey(parsed.sha256, block.id) : "";
    if (key && store?.getImage) {
      try {
        const cached = await store.getImage(key);
        const src = imageSrc(cached);
        if (src && img.isConnected !== false) {
          img.src = src;
          img.removeAttribute("data-crop");
          return;
        }
      } catch { /* cache */ }
    }
    img.setAttribute("data-crop", "pending");
    const drawn = await cropAt2x(block);
    if (!drawn || img.isConnected === false) return;
    img.src = drawn;
    img.removeAttribute("data-crop");
    if (key && store?.putImage) {
      try { await store.putImage(key, drawn); } catch { /* cache */ }
    }
  }

  async function geometryOf(n, pdf) {
    if (typeof loadGeometry === "function") {
      const got = await loadGeometry(n);
      if (got?.lines) return got;
      if (got) return parsePageGeometry(got, n);
    }
    if (!pdf || typeof pdf.getPage !== "function") return emptyGeometry(n);
    const page = await pdf.getPage(n);
    const data = await loadPageData(page);
    return parsePageGeometry(data, n);
  }

  function rangeOf(total) {
    if (Array.isArray(range) && range.length === 2) return [range[0], range[1]];
    if (rangeLabel === "Current page") {
      const page = Number(pageNow?.()) || 1;
      return [page, page];
    }
    return [1, total];
  }

  async function finishDoc(docResult, ms) {
    if (dead) return;
    const optsHash = await optionsHash(docResult.options || BUILTIN_OPTIONS);
    if (dead) return;
    parsed = { ...docResult, optsHash, stats: { ...(docResult.stats || {}), ms } };
    phase = "idle";
    try {
      await store?.putParse?.(parsed);
      if (currentUrl) {
        await store?.indexUrl?.(currentUrl, { sha256: parsed.sha256, pageCount: parsed.pageCount });
        rememberParsedUrl(storage, currentUrl);
        try { onCached?.(currentUrl); } catch { /* host */ }
      }
    } catch { /* cache */ }
    render();
    onProgress?.({ page: progress.pageCount, pageCount: progress.pageCount, fraction: 1 });
  }

  async function parseBuiltin(explicit) {
    cancel();
    const ctrl = new AbortController();
    abort = ctrl;
    phase = "running";
    progress = { page: 0, pageCount: 0, engine: "builtin" };
    paintChip();
    const pdf = typeof getPdf === "function" ? await getPdf() : null;
    if (ctrl.signal.aborted) return;
    const total = Number(pdf?.numPages) || Number(explicit?.numPages) || 1;
    if (!explicit?.pages && !rangeTouched) applyDefaultRange(total);
    const [from, to] = explicit?.pages || rangeOf(total);
    const t0 = now();
    records = [];
    let sha = parsed?.sha256 || "";
    try {
      if (!sha && pdf && typeof pdf.getData === "function") sha = await sha256Hex(await pdf.getData());
    } catch { sha = sha || ""; }
    for (let n = from; n <= to; n += 1) {
      if (ctrl.signal.aborted) return;
      progress = { page: n, pageCount: to, engine: "builtin" };
      paintChip();
      onProgress?.({ page: n, pageCount: to, fraction: (n - from + 1) / Math.max(1, to - from + 1) });
      const rec = await geometryOf(n, pdf);
      if (ctrl.signal.aborted) return;
      records.push(rec);
      const preview = assembleDocument(records, {
        numPages: total,
        sha256: sha,
        options: BUILTIN_OPTIONS,
        from,
        to: n,
      });
      preview.stats = { ...(preview.stats || {}), ms: now() - t0 };
      parsed = preview;
      render();
      if (n < to) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (ctrl.signal.aborted) return;
    const finalDoc = assembleDocument(records, {
      numPages: total,
      sha256: sha,
      options: BUILTIN_OPTIONS,
      from,
      to,
    });
    await finishDoc(finalDoc, now() - t0);
    // Engine "auto" with a ready helper reads scanned pages without a click.
    if (scanAuto && scanPagesOf(finalDoc).length) {
      await refreshHelper();
      if (helperState === "ready") await readScanNow();
    }
  }

  function paintScan() {
    const pages = parsed ? scanPagesOf(parsed) : [];
    scanBtn.hidden = !(pages.length && helperState === "ready" && phase !== "running" && typeof helper?.ocr === "function");
    if (!scanBtn.hidden) scanBtn.textContent = pages.length === 1 ? `Read the scan (p. ${pages[0]})` : `Read the scan (${pages.length} pages)`;
  }

  // Read the scan: helper OCR for the scan pages of the current parse, engine on the result,
  // merged into the document (a scanLayer page keeps the better table reading). No writes.
  async function readScanNow() {
    if (!parsed || !helper || typeof helper.ocr !== "function" || helperState !== "ready") return;
    const pages = scanPagesOf(parsed);
    if (!pages.length) return;
    cancel();
    const ctrl = new AbortController();
    abort = ctrl;
    phase = "running";
    progress = { page: 0, pageCount: pages.length, engine: "builtin" };
    paintChip();
    paintScan();
    try {
      const pdf = typeof getPdf === "function" ? await getPdf() : null;
      if (ctrl.signal.aborted) return;
      const bytes = pdf && typeof pdf.getData === "function" ? await pdf.getData() : null;
      if (ctrl.signal.aborted) return;
      const [from, to] = parsed.stats?.range || [1, parsed.pageCount || 1];
      let recs = records.length ? records : [];
      if (!recs.length) {
        for (let n = from; n <= to; n += 1) {
          if (pages.includes(n)) continue;
          recs.push(await geometryOf(n, pdf));
          if (ctrl.signal.aborted) return;
        }
      }
      const t0 = now();
      const result = await readScan({
        helper, bytes, sha256: parsed.sha256, base: parsed, records: recs, pages,
        numPages: parsed.pageCount, from, to, signal: ctrl.signal,
        onPhase: (info) => {
          progress = { page: info?.phase === "cells" ? pages.length : 0, pageCount: pages.length, engine: "builtin" };
          paintChip();
          onProgress?.({ page: progress.page, pageCount: pages.length, fraction: info?.phase === "cells" ? 0.9 : 0.3 });
        },
      });
      if (ctrl.signal.aborted) return;
      if (result?.records) records = result.records;
      const read = (result?.records || []).filter((rec) => rec?.ocr && (result.pages || pages).includes(rec.n));
      if (read.length) { try { onOcrPages?.(read, parsed.sha256); } catch { /* host */ } }
      await finishDoc(result.doc, (parsed.stats?.ms || 0) + (now() - t0));
    } catch (error) {
      if (error?.name !== "AbortError") { try { onToast?.(`Read the scan failed: ${error?.message || error}`); } catch { /* host */ } }
      phase = "idle";
      paintChip();
    }
    paintScan();
  }

  async function parseDocling() {
    if (!helper || helperState !== "ready") {
      helperState = helperState || "not-running";
      paintChip();
      return;
    }
    cancel();
    const ctrl = new AbortController();
    abort = ctrl;
    phase = "running";
    progress = { page: 0, pageCount: 0, engine: "docling" };
    paintChip();
    const pdf = typeof getPdf === "function" ? await getPdf() : null;
    const bytes = pdf && typeof pdf.getData === "function" ? await pdf.getData() : null;
    const result = await helper.parse({
      bytes,
      sha256: parsed?.sha256,
      options: {},
      signal: ctrl.signal,
      onProgress: (info) => {
        progress = { page: info?.page || progress.page, pageCount: info?.total || info?.pageCount || progress.pageCount, engine: "docling" };
        paintChip();
        onProgress?.(progress);
      },
      onPage: (info) => {
        if (info?.job) jobId = info.job;
        progress = { page: info?.page || progress.page, pageCount: info?.total || progress.pageCount, engine: "docling" };
        paintChip();
      },
    });
    jobId = result?.job || jobId;
    if (result?.doc) await finishDoc(result.doc, result.doc.stats?.ms ?? 0);
    else phase = "idle";
    paintChip();
  }

  async function reparseTable(table) {
    if (!helper || typeof helper.reparseTable !== "function") {
      helperState = helperState || "not-running";
      paintChip();
      render();
      return;
    }
    const pdf = typeof getPdf === "function" ? await getPdf() : null;
    const bytes = pdf && typeof pdf.getData === "function" ? await pdf.getData() : null;
    const result = await helper.reparseTable({
      bytes,
      sha256: parsed?.sha256,
      page: table.page,
      bbox: table.bbox,
      base: parsed,
    });
    if (result?.job) jobId = result.job;
    if (result?.merged) {
      parsed = result.merged;
      await finishDoc(parsed, parsed.stats?.ms ?? 0);
    }
  }

  function cancel() {
    try { abort?.abort?.(); } catch { /* already */ }
    abort = null;
    if (jobId && typeof helper?.cancel === "function") {
      const id = jobId;
      jobId = "";
      Promise.resolve(helper.cancel(id)).catch(() => {});
    }
    if (phase === "running") phase = "idle";
    paintChip();
  }

  function onKey(event) {
    const owned = parseOwnsKey(event, root, pointerTarget);
    const command = keyCommand(event, { textEntry: isTextEntryTarget(event.target) || isTextEntryTarget(doc.activeElement), owned });
    if (!command) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    if (command === "next") move(1, false);
    else if (command === "prev") move(-1, false);
    else if (command === "extend-next") move(1, true);
    else if (command === "extend-prev") move(-1, true);
    else if (command === "toggle") {
      if (!focusId) return;
      selected = selected.includes(focusId) ? selected.filter((id) => id !== focusId) : selected.concat(focusId);
      render();
    } else if (command === "locate") locate(shown().find((block) => block.id === focusId));
    else if (command === "copy") void copySelection(Boolean(event.shiftKey));
    else if (command === "send") callSession("sendParsedToBoard");
    else if (command === "insert") insertSelection();
    else if (command === "highlight") {
      const block = shown().find((item) => item.id === (focusId || selected[0]));
      void makeHighlight({
        block,
        live: readerEl,
        pageEl,
        page: pageInfo(block?.page),
        getContext,
        adoptCreated,
        toast: onToast,
      });
    } else if (command === "docling-table") {
      const block = shown().find((item) => item.id === focusId && item.type === "table")
        || shown().find((item) => item.type === "table");
      if (block) void reparseTable(block);
    } else if (command === "prev-table" || command === "next-table") {
      const blocks = shown();
      const tables = blocks.filter((item) => item.type === "table");
      if (!tables.length) return;
      const index = tables.findIndex((item) => item.id === focusId);
      const step = command === "next-table" ? 1 : -1;
      const next = tables[(index + step + tables.length) % tables.length];
      focusId = next.id;
      selected = [next.id];
      anchor = blocks.findIndex((item) => item.id === next.id);
      render();
    } else if (command === "search") {
      try { search.focus?.(); } catch { /* stub */ }
    } else if (command === "clear") {
      if (selected.length) { selected = []; anchor = -1; render(); return; }
      try { readerEl?.focus?.(); } catch { /* reader */ }
    }
  }

  function firstVisiblePage() {
    const nodes = body.querySelectorAll?.(".pxd-parse__page") || [];
    const top = body.getBoundingClientRect?.()?.top ?? 0;
    let best = null;
    for (const node of nodes) {
      const rect = node.getBoundingClientRect?.();
      const page = Number(node.getAttribute?.("data-page"));
      if (!Number.isFinite(page)) continue;
      if (!best && rect) best = page;
      if (rect && rect.bottom >= top) return page;
    }
    return best;
  }

  function onBodyScroll() {
    if (echo) return;
    const decision = syncDecision({
      locked,
      wheeling: now() < wheelingUntil,
      now: now(),
      last: lastJump,
    });
    lastJump = decision.last;
    if (!decision.jump) return;
    const page = firstVisiblePage();
    if (page) {
      try { jumpPage?.(page); } catch { /* reader */ }
    }
  }

  function armKeys() {
    if (keyFn) return;
    keyFn = onKey;
    const win = doc.defaultView;
    listen(win, "keydown", keyFn, true);
  }

  listen(body, "scroll", onBodyScroll);
  listen(body, "click", (event) => {
    const row = event.target?.closest?.(".pxd-parse__block");
    if (!row) return;
    const id = row.getAttribute("data-id");
    const block = shown().find((item) => item.id === id);
    if (!block) return;
    if (event.target?.closest?.(".pxd-parse__check, .pxd-parse__handle, .pxd-parse__tmenu, button, a")) {
      if (event.target?.closest?.(".pxd-parse__check")) {
        const extend = event.shiftKey;
        if (extend && anchor >= 0) move(indexOfId(id) - indexOfId(focusId || id), true);
        else {
          focusId = id;
          anchor = indexOfId(id);
          selected = selected.includes(id) ? selected.filter((item) => item !== id) : selected.concat(id);
          render();
        }
      }
      return;
    }
    focusId = id;
    if (event.shiftKey && anchor >= 0) {
      const next = indexOfId(id);
      const from = Math.min(anchor, next);
      const to = Math.max(anchor, next);
      selected = shown().slice(from, to + 1).map((item) => item.id);
    } else if (!event.metaKey && !event.ctrlKey) {
      anchor = indexOfId(id);
      selected = [id];
    }
    render();
    locate(block);
    if (block.type === "table") overlay.showGrid(block);
    else overlay.show(block);
  });
  listen(body, "pointerover", (event) => {
    const row = event.target?.closest?.(".pxd-parse__block");
    if (!row) return;
    const block = shown().find((item) => item.id === row.getAttribute("data-id"));
    if (!block) return;
    if (block.type === "table") overlay.showGrid(block);
    else overlay.show(block);
  });
  listen(body, "pointerout", (event) => {
    const next = event.relatedTarget;
    if (next && root.contains?.(next)) return;
    overlay.hide();
  });
  listen(root, "pointermove", (event) => { pointerTarget = event.target; });
  const pops = [enginePop, rangePop, filterPop];
  const closeMenus = () => { for (const pop of pops) setHidden(pop, true); };
  const toggleMenu = (pop) => {
    const open = pop.hidden !== true && !pop.hasAttribute?.("hidden");
    closeMenus();
    setHidden(pop, open);
  };
  function paintRangeButton() {
    rangeBtn.textContent = rangeLabel === "Current page" ? "Current page" : (rangeLabel || "All");
    currentBtn.setAttribute("aria-pressed", rangeLabel === "Current page" ? "true" : "false");
    allBtn.setAttribute("aria-pressed", rangeLabel === "All" ? "true" : "false");
  }
  function applyDefaultRange(total) {
    if (defaultRangeChoice(total) === "current") {
      rangeLabel = "Current page";
      const page = Number(pageNow?.()) || 1;
      range = [page, page];
    } else {
      rangeLabel = "All";
      range = null;
    }
    paintRangeButton();
  }
  listen(parseBtn, "click", () => { closeMenus(); void parseBuiltin(); });
  listen(chip, "click", () => { toggleMenu(enginePop); });
  listen(againBtn, "click", () => { closeMenus(); void parseBuiltin(); });
  listen(cancelBtn, "click", () => { closeMenus(); cancel(); });
  listen(scanBtn, "click", () => { closeMenus(); void readScanNow(); });
  listen(doclingBtn, "click", () => {
    closeMenus();
    void (async () => {
      await refreshHelper();
      if (helperState === "ready") await parseDocling();
    })();
  });
  listen(rangeBtn, "click", () => { toggleMenu(rangePop); });
  listen(filterBtn, "click", () => { toggleMenu(filterPop); });
  listen(currentBtn, "click", () => {
    rangeTouched = true;
    rangeLabel = "Current page";
    const page = Number(pageNow?.()) || 1;
    range = [page, page];
    rangeInput.value = "";
    paintRangeButton();
    closeMenus();
    render();
  });
  listen(allBtn, "click", () => {
    rangeTouched = true;
    rangeLabel = "All";
    range = null;
    rangeInput.value = "";
    paintRangeButton();
    closeMenus();
    render();
  });
  listen(rangeInput, "change", () => {
    rangeTouched = true;
    const text = String(rangeInput.value || "").trim();
    const match = /^(\d+)\s*[–-]\s*(\d+)$/.exec(text);
    if (match) {
      range = [Number(match[1]), Number(match[2])];
      rangeLabel = text;
    } else if (/^\d+$/.test(text)) {
      range = [Number(text), Number(text)];
      rangeLabel = text;
    } else if (!text) {
      range = null;
      rangeLabel = "All";
    } else {
      range = null;
      rangeLabel = "All";
    }
    paintRangeButton();
    render();
  });
  listen(searchBtn, "click", () => {
    const open = search.hidden === true || search.hasAttribute?.("hidden");
    setHidden(search, !open);
    if (open) { try { search.focus?.(); } catch { /* stub */ } }
  });
  listen(doc, "click", (event) => {
    if (bar.contains?.(event.target)) return;
    closeMenus();
  });
  listen(search, "input", () => { query = String(search.value || ""); render(); });
  for (const [key, button] of Object.entries(filterBtns)) {
    listen(button, "click", () => {
      filters[key] = !filters[key];
      button.setAttribute("aria-pressed", filters[key] ? "true" : "false");
      render();
    });
  }
  listen(lockBtn, "click", () => {
    locked = !locked;
    lockBtn.setAttribute("aria-pressed", locked ? "false" : "true");
    lockBtn.setAttribute("aria-label", locked ? "Sync scroll off" : "Sync scroll");
  });
  listen(copyBtn, "click", (event) => { void copySelection(Boolean(event.shiftKey)); });
  listen(insertBtn, "click", () => { insertSelection(); });
  listen(sendBtn, "click", () => { callSession("sendParsedToBoard"); });
  listen(hlBtn, "click", () => {
    const block = shown().find((item) => selected.includes(item.id) && TEXT_TYPES.has(item.type))
      || shown().find((item) => item.id === focusId);
    void makeHighlight({ block, live: readerEl, pageEl, page: pageInfo(block?.page), getContext, adoptCreated, toast: onToast });
  });
  listen(tableMenu, "click", (event) => {
    const mode = event.target?.getAttribute?.("data-mode");
    if (!mode) return;
    callSession("insertParsedTable", { mode, kind: "table" });
  });
  if (readerEl) {
    wheelFn = () => { wheelingUntil = now() + 400; };
    listen(readerEl, "wheel", wheelFn);
  }

  async function restore() {
    if (!store || !currentUrl) return null;
    const hit = await store.findByUrl(currentUrl);
    if (!hit?.sha256) return null;
    const hash = await optionsHash(BUILTIN_OPTIONS);
    const engines = ["builtin", "docling", "mixed"];
    for (const engine of engines) {
      const found = await store.getParse(hit.sha256, engine, hash);
      if (found) {
        parsed = found;
        rememberParsedUrl(storage, currentUrl);
        try { onCached?.(currentUrl); } catch { /* host */ }
        render();
        return found;
      }
    }
    return null;
  }

  async function refreshHelper() {
    if (!helper || typeof helper.health !== "function") return;
    try {
      const health = await helper.health();
      helperState = health?.state || "not-running";
    } catch {
      helperState = "not-running";
    }
    paintChip();
  }

  armKeys();
  render();
  void refreshHelper();

  return {
    element: () => root,
    refreshHelper,
    readScan: readScanNow,
    setTarget(next) {
      currentUrl = next?.url || "";
      currentUid = next?.pdfUid || "";
    },
    restore,
    parseBuiltin,
    parseDocling,
    cancel,
    showDoc(docResult) {
      parsed = docResult;
      render();
    },
    noteReaderWheel() { wheelingUntil = now() + 400; },
    scrollBody() { onBodyScroll(); },
    focusSearch() { try { search.focus(); } catch { /* stub */ } },
    chipText: () => chip.textContent,
    selectedIds: () => selected.slice(),
    blockCount: () => shown().length,
    refreshHelper,
    watchPageInput(input) {
      if (!input) return;
      const apply = () => {
        const page = Number(String(input.value || "").trim());
        if (!page) return;
        echo = true;
        const node = body.querySelector?.(`[data-page="${page}"]`);
        if (node) body.scrollTop = Number(node.offsetTop) || 0;
        echo = false;
      };
      listen(input, "input", apply);
      if (typeof doc.defaultView?.MutationObserver === "function") {
        const obs = new doc.defaultView.MutationObserver(apply);
        try { obs.observe(input, { attributes: true, characterData: true, subtree: true }); } catch { /* stub */ }
        armed.push([null, "observer", () => obs.disconnect(), false]);
      }
    },
    dispose() {
      dead = true;
      cancel();
      try { cropObserver?.disconnect(); } catch { /* gone */ }
      cropWaiting.clear();
      overlay.dispose();
      pageChips.dispose();
      clearBlockListeners();
      for (const [node, type, fn, capture] of armed) {
        if (type === "observer") { try { fn(); } catch { /* observer */ } continue; }
        try { node?.removeEventListener?.(type, fn, capture); } catch { /* gone */ }
      }
      armed.length = 0;
      keyFn = null;
      wheelFn = null;
      try { root.remove(); } catch { /* gone */ }
    },
  };
}
