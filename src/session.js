import { namespaceParent } from "./model/namespace.js";
import { READS_KEY, mergeReads } from "./host/read-keep.js";
import { SYNC_HOLD_BATCH, SYNC_HOLD_CAP_MS, createSyncHold } from "./host/sync-hold.js";
import { CONTAINER_STRING, isContainerString, parseRegion, PIN_CONTAINER_STRING } from "./model/regions.js";
import { imagePolyString, imageRegionString } from "./model/image-region.js";
import { renameRegionCaption } from "./model/region-menu.js";
import { edgeMayTarget, endpointKindOf, imageSourceOf, regionCaption } from "./model/endpoints.js";
import { planPinWrites, sourceAttrString } from "./model/pdf-pin.js";
import { backgroundImage, calendarLayout, cardTemplatePlan, zoomThreshold } from "./model/section6.js";
import { dateSource } from "./model/timeline.js";
import {
  boardPreview,
  boundsOf,
  buildBoard,
  cardAtCenter,
  containerAt,
  descendantsOf,
  diffBoards,
  edgesTouching,
  findEdge,
  itemsInRect,
  membershipPlan,
  outlineOrder,
  readingOrder,
  sectionAdoptPlan,
  sectionFitPlan,
  toRelative,
  topLevelOf,
  worldRects,
} from "./model/board.js";
import { whyPlan } from "./model/why.js";
import { isInlinePdfCard, pageCardString } from "./model/pdf-page.js";
import { isOldTableCard } from "./model/table-captions.js";
import { hasQueryMacro, planQueryFolds } from "./model/query-fold.js";
import { trailString } from "./model/trails.js";
import {
  BOARD_PATTERNS,
  DOCK_POSITIONS,
  DEFAULT_BOARD_CARD,
  DEFAULT_SIZES,
  FIT_PAD,
  ITEM_STYLE_KEYS,
  MIN_SIZES,
  STICKY_COLOR,
  STICKY_SIZE,
  SCHEMA_VERSION,
  SECTION_STYLE_KEYS,
  boardColor,
  classifyString,
  firstLine,
  normalizeSectionDefaults,
  attrNameOf,
  boardString,
  dailyPageTitle,
  edgeString,
  mergePropsForWrite,
  normalizeEdge,
  plainKeys,
  readPlexus,
  semanticRef,
  styleColor,
  lookForNewString,
  serializeEdge,
  serializeItemLayout,
  setBoardTitle,
  withBoardMarker,
} from "./model/schema.js";
import { drawingCreateSpec, drawingRefString } from "./model/drawing-card.js";
import { appendTable, parsedTableCaption, parsedTableSize, TABLE_SIZE } from "./model/roam-table.js";
import { flatRows, toGridSpec } from "./model/parse-to-grid.js";
import { escapeMarkdownText, flattenLine, linkSafeText, toRoamMarkdown } from "./model/parse-to-roam-md.js";
import {
  FOOTNOTES_HEADER, FOOTNOTE_CAP, WRITE_BUDGET, footnoteFormat, hasFootnoteTokens, planFootnotes, plainFootnotes, prepareTable,
} from "./model/footnotes.js";
import { HIGHLIGHT_COLORS, rewriteHighlightTag } from "./model/highlight.js";
import { inflate, rectsIntersect, unionRect } from "./model/geometry.js";
import { SHAPES } from "./model/shapes.js";
import { sameSize as sameSizeRects, spaceOut as spaceOutRects, tidyRects } from "./model/layout.js";
import { coveredBy, filterLinks, linksQuery, reduceLinks } from "./model/links.js";
import { isQueryString } from "./model/query.js";
import { autoEligibility, storedLayoutIn } from "./discovery.js";
import { createEchoLedger, createWriteQueue } from "./host/roam.js";
import { sharedBgBudget } from "./bg-budget.js";
import { notedSpeedFlags } from "./settings.js";
import { executeImport, planImport, readNative, readV06Entry } from "./host/migrate.js";
import { CHILD_GROW_H, kidsHeightPlan, rememberUnfoldedSize } from "./model/card-children.js";

const UID = ":block/uid";
const STR = ":block/string";
const ORD = ":block/order";
const KIDS = ":block/children";
const PROPS = ":block/props";
const OPEN = ":block/open";

const LINK_MODES = ["off", "attributes", "all"];
const ITEM_KEYS = ["type", "x", "y", "w", "h", "color", "collapsed", "fontSize", "pinned", "min", "kids", "fit", "look", "axis", "textColor", "align", "fill", "border", "titleSize", "titleColor", "titleFill", "areaFill", "shape", "landmark", "glyph", "size"];
const EDGE_KEYS = ["type", "from", "to", "fromSide", "toSide", "dir", "route", "dash", "weight", "color", "fromBlock", "toBlock", "via"];
const MAX_PARENT_STRINGS = 200;
// A held big board whose resume Roam refused (rate limit while rebuilding an expired hold) tries again after this.
export const RESUME_RETRY_MS = 1000;
// A parked big board's highlight watches go when the host's hold on its own watches does (SPLIT_HOLD_MS).
export const HIGHLIGHT_HOLD_MS = 60000;
// Link-query targets per idle slice on a big board.
const LINK_CHUNK = 120;
// P8 U2: a big board's links start after the board sat still this long. Each refs query has a fixed cost (~9 ms on
// the PhD main board whatever its size), so parts are LINK_PART targets (~25 ms there), one per slice unless the slice
// still has room for another.
const LINK_QUIET_MS = 1500;
const LINK_PART = 100;
const DAILY_GAP = 20;
const HIGHLIGHT_WATCH_CAP = 60;

const registry = new Map();
const extensions = [];

// Roam's undo stack holds 50 changes, so one bulk add stays under it: past 45 cards only the first 45 are made.
export const BULK_CARD_CAP = 45;
// F12. Roam's sync queue confirms one write at a time, slower the longer the queue (18k queued writes wedged a
// graph for ~30 hours on 2026-10-12). One transaction that plans this many writes asks first; past the second
// line it is refused (duplicating one big section of the PhD main board was ~18.5k creates).
export const BULK_CONFIRM_WRITES = 600;
export const BULK_REFUSE_WRITES = 3000;

// One create. The parent is the board uid. x and y default to 40. No second parent.
export function addPublicCard(opts = {}, createFn) {
  const { string = "", x, y, boardUid, create } = opts && typeof opts === "object" ? opts : {};
  const op = {
    parent: boardUid,
    string: String(string ?? ""),
    x: Number.isFinite(x) ? x : 40,
    y: Number.isFinite(y) ? y : 40,
  };
  const make = typeof create === "function" ? create : createFn;
  if (typeof make !== "function") return op;
  return make(op);
}
// One fromMarkdown call holds at most this many bullet lines. A single top-level tree
// that is larger stays one call so a nested table is never split.
export const PARSE_BLOCK_CHUNK = 400;
export const PARSE_CHUNK_CAP = 10;
// Each sent section is fromMarkdown + props (2 writes). host.group splits at 45 writes,
// and undo pops one chunk, so 45 cards would be two Plexus undo steps. 22 × 2 = 44.
export const PARSE_SECTION_CAP = Math.floor(BULK_CARD_CAP / 2);
const PARSE_TOO_LARGE = "This range is too large. Narrow it and insert again.";
const SECTION_GAP = 24;

// Indent every line from the second top-level bullet so one root carries the layout props.
export function nestMarkdownUnderFirst(markdown) {
  const lines = String(markdown ?? "").split("\n");
  let seen = 0;
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^- /.test(lines[i])) {
      seen += 1;
      if (seen === 2) { start = i; break; }
    }
  }
  if (start < 0) return lines.join("\n");
  return lines.map((line, i) => (i >= start && line !== "" ? `  ${line}` : line)).join("\n");
}

function bulletCount(markdown) {
  return (String(markdown ?? "").match(/^\s*- /gm) || []).length;
}

function topLevelTrees(markdown) {
  const trees = [];
  let current = null;
  for (const line of String(markdown ?? "").split("\n")) {
    if (/^- /.test(line)) {
      current = [line];
      trees.push(current);
    } else if (current) current.push(line);
  }
  return trees;
}

function chunkParsedMarkdown(markdown, blockEstimate) {
  const text = String(markdown ?? "");
  const bullets = bulletCount(text);
  const estimate = Number.isFinite(Number(blockEstimate)) ? Number(blockEstimate) : bullets;
  const ceiling = PARSE_BLOCK_CHUNK * PARSE_CHUNK_CAP;
  if (bullets > ceiling || estimate > ceiling) return { ok: false, reason: "too-large" };
  if (!text.trim() || bullets === 0) return { ok: true, chunks: [] };
  const chunks = [];
  let buf = [];
  let count = 0;
  const treeBullets = (tree) => tree.filter((line) => /^\s*- /.test(line)).length;
  for (const tree of topLevelTrees(text)) {
    const n = treeBullets(tree);
    if (count > 0 && count + n > PARSE_BLOCK_CHUNK) {
      chunks.push(buf.join("\n"));
      buf = [];
      count = 0;
    }
    buf.push(...tree);
    count += n;
  }
  if (buf.length) chunks.push(buf.join("\n"));
  if (chunks.length > PARSE_CHUNK_CAP) return { ok: false, reason: "too-large" };
  return { ok: true, chunks };
}

function advanceOrder(order, rootCount) {
  if (typeof order !== "number") return "last";
  return order + Math.max(rootCount, 1);
}

function flatTableMarkdown(table) {
  const lines = ["- {{[[table]]}}"];
  for (const row of flatRows(table)) {
    for (let c = 0; c < row.length; c += 1) {
      lines.push(`${"  ".repeat(c + 1)}- ${escapeMarkdownText(String(row[c] ?? ""))}`);
    }
  }
  return lines.join("\n");
}

function nativeTableMarkdown(table) {
  const id = typeof table?.id === "string" && table.id ? table.id : "t1";
  const block = { ...table, id, type: table?.type || "table" };
  return toRoamMarkdown({ blocks: { [id]: block }, order: [id] }, [id]).markdown;
}

// `limit` is for a gesture that already spent part of the 45-write budget on its own blocks.
export function capBulk(list, emit, limit = BULK_CARD_CAP) {
  const raw = Number(limit);
  const cap = Math.min(BULK_CARD_CAP, Math.max(0, Number.isFinite(raw) ? Math.floor(raw) : BULK_CARD_CAP));
  if (list.length <= cap) return list;
  emit("toast", { message: `Added ${cap} of ${list.length} (Roam undo holds 50 changes)` });
  return list.slice(0, cap);
}

// Registers fn(session, api); every session created afterwards runs it once before it is returned.
// Returns a function that removes the registration.
export function extendSession(fn) {
  if (typeof fn !== "function") return () => {};
  extensions.push(fn);
  return () => {
    const at = extensions.indexOf(fn);
    if (at >= 0) extensions.splice(at, 1);
  };
}

// Pull trees are plain JSON. A JSON round trip of the PhD main board's 22k blocks was ~16 ms per watch fire; this is
// ~2.5 ms. Undefined fields drop as they did.
export function cloneTree(v) {
  if (Array.isArray(v)) {
    const out = new Array(v.length);
    for (let i = 0; i < v.length; i += 1) {
      const x = v[i];
      out[i] = x !== null && typeof x === "object" ? cloneTree(x) : x === undefined ? null : x;
    }
    return out;
  }
  if (v !== null && typeof v === "object") {
    const out = {};
    for (const k in v) {
      const x = v[k];
      if (x === undefined || typeof x === "function") continue;
      out[k] = x !== null && typeof x === "object" ? cloneTree(x) : x;
    }
    return out;
  }
  return v;
}
const clone = (v) => (v == null ? v : cloneTree(v));
const round1 = (n) => Math.round(n * 10) / 10;

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) if (v[k] !== undefined) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}
const stable = (v) => (v == null ? "null" : JSON.stringify(sortKeys(v)));

function kidsOf(node) {
  const kids = Array.isArray(node?.[KIDS]) ? node[KIDS] : [];
  return kids
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (a.c[ORD] ?? a.i) - (b.c[ORD] ?? b.i) || a.i - b.i)
    .map(({ c }) => c);
}

function indexTree(root) {
  const map = new Map();
  const walk = (node, parent) => {
    map.set(node[UID], { node, parent });
    for (const c of node[KIDS] ?? []) walk(c, node);
  };
  if (root) walk(root, null);
  return map;
}

function detach(idx, uid) {
  const hit = idx.get(uid);
  if (!hit?.parent) return null;
  const kids = hit.parent[KIDS] ?? [];
  const at = kids.indexOf(hit.node);
  if (at >= 0) kids.splice(at, 1);
  return hit;
}

function attach(parentNode, node, order) {
  const kids = kidsOf(parentNode);
  if (order === "first") kids.unshift(node);
  else if (order === "last" || typeof order !== "number") kids.push(node);
  else kids.splice(Math.max(0, Math.min(order, kids.length)), 0, node);
  kids.forEach((k, i) => { k[ORD] = i; });
  parentNode[KIDS] = kids;
}

function findChild(root, uid) {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (node[UID] === uid) return node;
    const kids = node[KIDS];
    if (Array.isArray(kids)) for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
  return null;
}

function refList(node) {
  const refs = node?.[":block/refs"];
  if (!refs) return [];
  const list = Array.isArray(refs) ? refs : [refs];
  return list
    .filter((ref) => ref && typeof ref === "object" && !Array.isArray(ref))
    .slice()
    .sort((a, b) => String(a[UID] ?? "").localeCompare(String(b[UID] ?? "")));
}

// True when the only differences are :block/string on uids in `allowed`.
function sameTree(a, b, allowed, state, stack) {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const id = a[UID] ?? null;
  if (id !== (b[UID] ?? null)) return false;
  if (id && stack.has(id)) return true;
  if (id) stack.add(id);
  try {
    const left = a[STR] ?? "";
    const right = b[STR] ?? "";
    if (left !== right) {
      if (!id || !allowed.has(id)) return false;
      state.hit = true;
    }
    if ((a[":node/title"] ?? null) !== (b[":node/title"] ?? null)) return false;
    if ((a[ORD] ?? null) !== (b[ORD] ?? null)) return false;
    if ((a[":block/heading"] || 0) !== (b[":block/heading"] || 0)) return false;
    if ((a[OPEN] !== false) !== (b[OPEN] !== false)) return false;
    if (stable(a[PROPS] ?? null) !== stable(b[PROPS] ?? null)) return false;
    const ak = kidsOf(a);
    const bk = kidsOf(b);
    if (ak.length !== bk.length) return false;
    for (let i = 0; i < ak.length; i++) if (!sameTree(ak[i], bk[i], allowed, state, stack)) return false;
    const ar = refList(a);
    const br = refList(b);
    if (ar.length !== br.length) return false;
    for (let i = 0; i < ar.length; i++) if (!sameTree(ar[i], br[i], allowed, state, stack)) return false;
    return true;
  } finally {
    if (id) stack.delete(id);
  }
}

function contentSig(nodes) {
  const out = [];
  const walk = (list) => {
    for (const node of list || []) {
      out.push(node?.[UID] ?? "", node?.[STR] ?? "");
      const kids = node?.[KIDS];
      if (Array.isArray(kids) && kids.length) walk(kids);
    }
  };
  walk(nodes);
  return out.join("\0");
}

// A typed string can stay on the item. A string that changes what the card is has to go through buildBoard.
function canPatchString(item, string) {
  if (item.type === "section") return true;
  if (item.type === "text") return classifyString(string).kind === "note";
  if (item.kind !== "note") return false;
  return classifyString(string).kind === "note";
}

function writeItemString(item, string) {
  item.string = string;
  item.title = item.type === "section" ? firstLine(string) : isQueryString(string) ? "Query" : firstLine(string);
}

function unknownKeys(plexus, known) {
  const out = {};
  for (const [k, v] of Object.entries(plexus ?? {})) if (!known.includes(k)) out[k] = v;
  return out;
}

function createSession(uid, { host, settings = null, virtual = false, raf, now = Date.now, idle, linkDelay = 1500, graceMs = 800, confirmBulk = null, syncHold = null } = {}) {
  const schedule = raf ?? ((fn) => {
    if (typeof globalThis.requestAnimationFrame === "function") return globalThis.requestAnimationFrame(fn);
    const t = setTimeout(fn, 0);
    t.unref?.();
    return t;
  });
  const runIdle = idle ?? ((fn) => {
    if (typeof globalThis.requestIdleCallback === "function") globalThis.requestIdleCallback(fn, { timeout: 2000 });
    else fn();
  });

  const listeners = new Map();
  const emit = (name, payload) => {
    for (const fn of [...(listeners.get(name) ?? [])]) {
      try { fn(payload); } catch (err) { console.error("[plexus session]", err); }
    }
  };

  let busy = false;
  const queue = createWriteQueue({ onBusy: (b) => { busy = b; emit("busy", b); } });
  // First try plus three retries. The optimistic model stays until the last failure.
  const WRITE_ATTEMPTS = 4;
  let syncState = "idle";
  const setSyncState = (state) => {
    if (syncState === state) return;
    syncState = state;
    emit("sync", state);
  };
  const ledger = createEchoLedger({ graceMs, now });

  let destroyed = false;
  // Light: the linked-ref and card-stat reads that ride on the open pull run in idle time,
  // after the board has painted (INSTANT-3).
  let raw = clone(host.pullBoard(uid, { light: true }));
  let board = null;
  let editingUid = null;
  let rects = new Map();
  let emitted = null;
  let dropQueued = false;
  let rix = null;

  const highlightWatches = new Map();
  // Props reads for highlight targets, dropped whenever a highlight watch fires. A plain ref never lands here.
  const propsCache = new Map();
  let knownHighlights = new Set();
  let highlightWatchReady = false;
  let syncHighlightWatches = () => {};
  const disposeHighlightWatch = (id) => {
    const off = highlightWatches.get(id);
    if (!off) return;
    highlightWatches.delete(id);
    try { off(); } catch { /* watch already gone */ }
  };
  const disposeHighlightWatches = () => {
    for (const id of [...highlightWatches.keys()]) disposeHighlightWatch(id);
  };

  const ix = () => (rix ??= indexTree(raw));
  // Auto-enhance: a board with no :plexus yet is shown as a board but nothing is written until the first edit stamps it.
  let virtualAllowed = virtual === true;
  const autoEnhanceOn = () => (typeof settings?.get === "function" ? settings.get("auto-enhance") : settings?.["auto-enhance"]) !== false;
  const autoBoardCache = new Map();
  // Pages this session just wrote a pdf block on: the optimistic paint resolves them before Roam has the page.
  const pendingPdfPages = new Map();
  // Page cards whose page has no pdf block: not read again for NOT_PDF_PAGE_MS (the board watch does not cover pages).
  const notPdfPages = new Map();
  const NOT_PDF_PAGE_MS = 30000;
  const autoBoardOf = (id, cplexus, kids) => {
    if (!autoEnhanceOn()) return false;
    if (!autoBoardCache.has(id)) {
      let count = 0;
      try {
        const nodes = host.pullNative?.(id)?.[":diagram/nodes"];
        count = Array.isArray(nodes) ? nodes.length : 0;
      } catch { count = 0; }
      autoBoardCache.set(id, count);
    }
    return autoEligibility({ plexus: cplexus, nativeNodeCount: autoBoardCache.get(id), storedLayout: storedLayoutIn(kids) }) === "virtual";
  };
  const rebuild = () => {
    rix = null;
    const plexusApi = globalThis.window?.RoamPlexus ?? globalThis.RoamPlexus ?? null;
    board = raw ? buildBoard(raw, {
      resolve: (id) => {
        try {
          const text = host.blockString?.(id);
          return typeof text === "string" ? text : null;
        } catch {
          return null;
        }
      },
      propsOf: (id) => {
        if (propsCache.has(id)) return propsCache.get(id);
        const bag = host.blockProps(id);
        propsCache.set(id, bag);
        return bag;
      },
      knownHighlight: (id) => knownHighlights.has(id),
      plexusApi,
      autoBoard: autoBoardOf,
      pdfOfPage: (title) => {
        const pending = pendingPdfPages.get(title) || null;
        const miss = notPdfPages.get(title);
        if (!pending && miss && Date.now() - miss < NOT_PDF_PAGE_MS) return null;
        let live = null;
        try { live = host.pdfOfPage?.(title) || null; } catch { live = null; }
        if (live) { pendingPdfPages.delete(title); notPdfPages.delete(title); return live; }
        if (!pending) notPdfPages.set(title, Date.now());
        return pending;
      },
    }) : null;
    if (board && virtualAllowed && autoEnhanceOn() && !board.enhanced && !board.native) {
      board.enhanced = true;
      board.virtual = true;
    }
    rects = board ? worldRects(board) : new Map();
    knownHighlights = new Set();
    if (board) for (const item of board.items.values()) if (item.kind === "highlight" && item.target?.uid) knownHighlights.add(item.target.uid);
    if (highlightWatchReady) syncHighlightWatches();
  };
  rebuild();
  emitted = board;

  let allLinks = [];
  let visibleLinks = [];
  let covered = new Set();
  let linkFingerprint = "";
  let linkRefs = linkRefKey(board);
  const initialMode = typeof settings?.get === "function" ? settings.get("graph-links") : settings?.["graph-links"];
  let linkMode = LINK_MODES.includes(initialMode) ? initialMode : "all";
  const setting = (name, fallback) => {
    const v = typeof settings?.get === "function" ? settings.get(name) : settings?.[name];
    return v == null || v === "" ? fallback : v;
  };
  const flag = (name, fallback) => {
    const v = setting(name, fallback);
    return v === true || v === "true" ? true : v === false || v === "false" ? false : fallback;
  };
  const sizeSetting = (name, fallback) => {
    const n = Number(setting(name, fallback));
    return Number.isFinite(n) && n >= 40 ? n : fallback;
  };
  const collapseOutline = () => (typeof settings?.get === "function" ? settings.get("collapse-outline") : settings?.["collapse-outline"]) !== false;

  // ---- raw tree helpers (optimistic model) ----
  const rawNode = (id) => (id === uid ? raw : ix().get(id)?.node ?? null);
  // New children go before Connections, snapshots, or a regions container so those stay last.
  const insertOrder = (parentUid) => {
    const node = raw ? rawNode(parentUid) : null;
    if (!node) return "last";
    const at = kidsOf(node).findIndex((k) => {
      const type = readPlexus(k[PROPS])?.type;
      if (type === "edges" || type === "snapshots" || type === "regions" || type === "trails") return true;
      return isContainerString(k[":block/string"] ?? k.string ?? "");
    });
    return at >= 0 ? at : "last";
  };
  const rawInsert = (parentUid, node, order) => {
    const parent = rawNode(parentUid);
    if (!parent) return;
    attach(parent, node, order);
    rix = null;
  };
  const rawMove = (id, parentUid, order) => {
    const hit = ix().get(id);
    if (!hit?.parent) return;
    detach(ix(), id);
    rix = null;
    const parent = rawNode(parentUid);
    if (parent) attach(parent, hit.node, order);
    rix = null;
  };
  const rawDelete = (id) => { detach(ix(), id); rix = null; };
  const rawProps = (id, plexus) => {
    const node = rawNode(id);
    if (node) node[PROPS] = mergePropsForWrite(node[PROPS], plexus);
  };
  const rawString = (id, string) => {
    const node = rawNode(id);
    if (node) node[STR] = string;
  };

  // An edge that was on the board and then vanished takes the edges that used it as an
  // end with it. The first open has nothing to compare, so a dangling arrow stays put
  // until a later reconcile sees the target disappear. Ordinary missing cards are not edges.
  // P9: while the board shows a stored model nobody has read again (host.boardUnverified), the vanished edges are only
  // noted; once the background read lands they are judged again against the fresh board.
  let heldGone = null;
  function queueDependentDrops(prev, next) {
    if (!prev?.edges || !next?.edges) return;
    const gone = [];
    for (const id of prev.edges.keys()) if (!next.edges.has(id)) gone.push(id);
    if (!gone.length) return;
    if (host.boardUnverified?.(uid) === true) {
      if (!heldGone) {
        heldGone = new Set();
        host.onBoardVerified?.(uid, () => {
          const ids = heldGone ? [...heldGone] : [];
          heldGone = null;
          if (destroyed || !board || !ids.length) return;
          dropDependentsOf(ids.filter((id) => !board.edges.has(id)));
        });
      }
      for (const id of gone) heldGone.add(id);
      return;
    }
    dropDependentsOf(gone);
  }
  function dropDependentsOf(gone) {
    if (dropQueued || !board?.edges || !gone.length) return;
    const next = board;
    const victims = [];
    for (const edge of next.edges.values()) {
      if (gone.includes(edge.from) || gone.includes(edge.to)) victims.push(edge.uid);
    }
    if (!victims.length) return;
    dropQueued = true;
    const lost = new Set(gone);
    queueMicrotask(() => {
      dropQueued = false;
      if (destroyed || !board) return;
      // A short published list is not proof of a delete: ask Roam. An edge that still exists there was lost by a read,
      // so its dependents stay, and the board is read again in full.
      let unconfirmed = false;
      for (const id of [...lost]) {
        if (host.blockExists?.(id) === true) { lost.delete(id); unconfirmed = true; }
      }
      const still = victims.filter((id) => {
        const edge = board.edges.get(id);
        return edge && (lost.has(edge.from) || lost.has(edge.to));
      });
      if (!still.length) {
        if (unconfirmed) repull();
        return;
      }
      const dropped = txn((t) => {
        for (const id of still) if (board.edges.has(id)) t.del(id);
      });
      if (unconfirmed) dropped.then(() => repull());
    });
  }

  const publish = () => {
    rebuild();
    if (!board) return null;
    const prev = emitted;
    const diff = diffBoards(prev, board);
    emitted = board;
    if (diff.structural || diff.dirty.size) emit("change", diff);
    recomputeLinks(false);
    const nextRefs = linkRefKey(board);
    if (nextRefs !== linkRefs) {
      linkRefs = nextRefs;
      refreshLinks();
    }
    queueDependentDrops(prev, board);
    return diff;
  };

  // The board block itself vanished (deleted, or undone away): tell the owner once so it can pop out.
  let gone = false;
  const markGone = () => {
    if (gone || destroyed) return;
    gone = true;
    disposeHighlightWatches();
    emit("gone", { uid });
  };
  const repull = () => {
    if (destroyed) return;
    const fresh = host.pullBoard(uid, { light: true });
    if (!fresh) { markGone(); return; }
    raw = clone(fresh);
    propsCache.clear();
    publish();
  };

  // ---- echo rebase ----
  function rebase(incoming) {
    const tracked = ledger.tracked();
    if (!tracked.length) return incoming;
    const ours = ix();
    const inc = indexTree(incoming);
    const incUid = incoming[UID];
    for (const [id, field] of tracked) {
      if (field === "parent") {
        const mine = ours.get(id);
        const theirs = inc.get(id);
        const myParent = mine?.parent?.[UID] ?? "";
        const theirParent = theirs?.parent?.[UID] ?? "";
        if (ledger.accept(id, "parent", theirParent)) continue;
        if (myParent === theirParent) continue;
        if (!mine) {
          detach(inc, id);
          inc.delete(id);
        } else if (!theirs) {
          const target = myParent === incUid ? incoming : inc.get(myParent)?.node;
          if (!target) continue;
          const node = { ...mine.node, [KIDS]: [] };
          target[KIDS] = [...(target[KIDS] ?? []), node];
          inc.set(id, { node, parent: target });
        } else {
          const target = myParent === incUid ? incoming : inc.get(myParent)?.node;
          if (!target) continue;
          detach(inc, id);
          theirs.node[ORD] = mine.node[ORD];
          target[KIDS] = [...(target[KIDS] ?? []), theirs.node];
          inc.set(id, { node: theirs.node, parent: target });
        }
      } else if (field === "props") {
        const theirs = inc.get(id);
        const mine = ours.get(id);
        if (!theirs) continue;
        const theirPlexus = readPlexus(theirs.node[PROPS]);
        if (ledger.accept(id, "props", stable(theirPlexus))) continue;
        if (!mine) continue;
        const myPlexus = readPlexus(mine.node[PROPS]);
        theirs.node[PROPS] = mergePropsForWrite(theirs.node[PROPS], myPlexus);
      } else if (field === "string") {
        const theirs = inc.get(id);
        const mine = ours.get(id);
        if (!theirs) continue;
        if (ledger.accept(id, "string", theirs.node[STR] ?? "")) continue;
        if (mine) theirs.node[STR] = mine.node[STR] ?? "";
      }
    }
    return incoming;
  }

  // ---- watch ----
  // Uids whose string may change while this card is open: the card, its outline, and a block it cites.
  const editingScope = (root, id) => {
    const allowed = new Set([id]);
    const item = board?.items.get(id);
    if (!item) return allowed;
    const node = findChild(root, id);
    if (node) {
      const walk = (n) => {
        const nid = n?.[UID];
        if (nid) allowed.add(nid);
        for (const child of kidsOf(n)) walk(child);
      };
      walk(node);
    }
    if (item.target?.uid) allowed.add(item.target.uid);
    return allowed;
  };
  const ownerOf = (root, id) => {
    let found = null;
    const walk = (node, itemUid) => {
      if (!node || found) return;
      const nid = node[UID];
      const next = nid && board?.items.has(nid) ? nid : itemUid;
      if (nid === id) { found = next; return; }
      for (const child of kidsOf(node)) walk(child, next);
    };
    walk(root, null);
    return found;
  };
  // The watch already delivered the new string. Patch that item and skip buildBoard.
  const typingFlush = (prev, next, id) => {
    if (!board || !prev || !next || !id) return null;
    const state = { hit: false };
    if (!sameTree(prev, next, editingScope(prev, id), state, new Set()) || !state.hit) return null;
    const owner = board.items.has(id) ? id : ownerOf(next, id);
    const item = owner ? board.items.get(owner) : null;
    if (!item) return { dirty: null };
    const node = ix().get(item.uid)?.node;
    if (!node) return null;
    for (const [iid, it] of board.items) {
      if (iid === item.uid) continue;
      const other = ix().get(iid)?.node;
      if (other && (other[STR] ?? "") !== it.string) return null;
    }
    const nextString = node[STR] ?? "";
    const own = nextString !== item.string;
    if (own && !canPatchString(item, nextString)) return null;
    if (own) writeItemString(item, nextString);
    let dirty = own;
    if (item.type !== "section") {
      const kids = kidsOf(node);
      if (contentSig(item.content) !== contentSig(kids)) dirty = true;
      item.content = kids;
    }
    return { dirty: dirty ? item.uid : null };
  };
  // Active holders want the board watch. A detached holder pauses without release,
  // so the session stays alive and the pull watch drops when nobody is showing it.
  let holders = 1;
  let pausedHolds = 0;
  let latest = null;
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    if (destroyed || pausedHolds >= holders || !latest) return;
    const incoming = clone(latest);
    latest = null;
    const prev = raw;
    raw = rebase(incoming);
    rix = null;
    const typed = editingUid ? typingFlush(prev, raw, editingUid) : null;
    if (typed) {
      if (typed.dirty) {
        emit("change", { structural: false, dirty: new Set([typed.dirty]) });
        if (!queue.pending) host.invalidateUndo?.();
      }
      return;
    }
    const diff = publish();
    // Our own writes and their echoes are already in the optimistic model: a change that still shows up once the
    // queue is idle is someone else's edit, so the host's grouped undo log no longer maps onto Roam's stack (the host
    // ignores the call inside its own echo window).
    if (diff && (diff.structural || diff.dirty.size) && !queue.pending) host.invalidateUndo?.();
  };
  const onBoard = (after) => {
    if (destroyed || pausedHolds >= holders) return;
    if (!after || !after[UID]) {
      if (!host.pullBoard(uid, { light: true })) markGone();
      return;
    }
    latest = after;
    if (!scheduled) { scheduled = true; schedule(flush); }
  };
  let boardWatch = () => {};
  let boardWatchOn = false;
  let resumeRetry = null;
  let highlightParked = false;
  let highlightHoldTimer = null;
  // Paused through a host handle that keeps its watches registered (big boards): no remove/add per park.
  let boardWatchHeld = false;
  if (raw && typeof host.watchBoard === "function") {
    boardWatch = host.watchBoard(uid, onBoard);
    boardWatchOn = true;
  }

  function dropBoardWatch() {
    if (!boardWatchOn) return;
    boardWatchOn = false;
    boardWatchHeld = false;
    try { boardWatch(); } catch { /* already dropped */ }
    boardWatch = () => {};
    disposeHighlightWatches();
    latest = null;
  }

  // One pull. An unchanged tree does not publish, so the view is not rebuilt.
  function catchUpBoard() {
    if (destroyed || pausedHolds >= holders) return;
    let fresh = null;
    try { fresh = host.pullBoard?.(uid, { light: true, deferRefs: true }); } catch { return; }
    if (!fresh || !fresh[UID]) {
      markGone();
      return;
    }
    let unchanged = false;
    try { unchanged = stable(fresh) === stable(raw); } catch { unchanged = false; }
    if (unchanged) return;
    latest = fresh;
    if (!scheduled) {
      scheduled = true;
      flush();
    }
  }

  function syncBoardWatch(catchUp) {
    if (destroyed) return;
    const want = holders > pausedHolds && Boolean(raw);
    if (want && boardWatchOn && boardWatchHeld) {
      // The host publishes once if the board changed while held.
      try {
        boardWatch.resume();
      } catch {
        // Roam refused the rebuild of an expired hold: still held, try again shortly.
        if (resumeRetry == null) {
          resumeRetry = setTimeout(() => { resumeRetry = null; syncBoardWatch(false); }, RESUME_RETRY_MS);
          try { resumeRetry.unref?.(); } catch { /* a browser timer has no unref */ }
        }
        return;
      }
      boardWatchHeld = false;
      // A tree that arrived in the frame before the park was kept by the skipped flush; the host will not re-send it.
      if (latest && !scheduled) { scheduled = true; schedule(flush); }
      if (highlightHoldTimer != null) { clearTimeout(highlightHoldTimer); highlightHoldTimer = null; }
      // Highlight watches went when the hold ended: rebuild them, and read their colours once.
      const hadHighlights = highlightParked;
      highlightParked = false;
      try { syncHighlightWatches(); } catch { /* highlights follow the board watch */ }
      if (hadHighlights) highlightDirty = true;
      if (highlightDirty && !highlightScheduled) { highlightScheduled = true; schedule(flushHighlights); }
    } else if (want && !boardWatchOn) {
      if (typeof host.watchBoard !== "function") return;
      boardWatch = host.watchBoard(uid, onBoard);
      boardWatchOn = true;
      try { syncHighlightWatches(); } catch { /* highlights follow the board watch */ }
      if (catchUp) catchUpBoard();
    } else if (!want && boardWatchOn && !boardWatchHeld) {
      if (typeof boardWatch.pause === "function") {
        boardWatch.pause();
        boardWatchHeld = true;
        // Each highlight watch is re-pulled on every Roam transaction: they stay as long as the host holds the
        // board's own watches (a quick return costs no watch calls), not for the whole park.
        if (highlightHoldTimer == null) {
          highlightHoldTimer = setTimeout(() => {
            highlightHoldTimer = null;
            if (destroyed || !boardWatchHeld) return;
            highlightParked = highlightParked || highlightWatches.size > 0;
            disposeHighlightWatches();
          }, HIGHLIGHT_HOLD_MS);
          try { highlightHoldTimer.unref?.(); } catch { /* a browser timer has no unref */ }
        }
      } else dropBoardWatch();
    }
  }

  // The colour tag lives on the highlight block, which is not a child of the board. One watch per target.
  // A watch only marks the board dirty; one pull per flush however many highlights changed.
  let highlightDirty = false;
  let highlightScheduled = false;
  const flushHighlights = () => {
    highlightScheduled = false;
    if (destroyed || pausedHolds >= holders || !highlightDirty) return;
    highlightDirty = false;
    propsCache.clear();
    onBoard(host.pullBoard(uid, { light: true }));
  };
  syncHighlightWatches = () => {
    const live = new Set();
    if (board && !destroyed) {
      for (const item of board.items.values()) {
        if (item.kind !== "highlight") continue;
        const id = item.target?.uid;
        if (typeof id !== "string" || id === "" || live.has(id)) continue;
        // The board pull already joined this ref, so the one board watch covers its colour.
        if (typeof host.coversBlock === "function" && host.coversBlock(id)) continue;
        // Past the cap a highlight colour refreshes when the board is next pulled.
        if (live.size >= HIGHLIGHT_WATCH_CAP) break;
        live.add(id);
        if (highlightWatches.has(id) || typeof host.watchBlock !== "function") continue;
        highlightWatches.set(id, () => {});
        let off = () => {};
        try {
          const ret = host.watchBlock(id, () => {
            if (destroyed) return;
            highlightDirty = true;
            if (!highlightScheduled) { highlightScheduled = true; schedule(flushHighlights); }
          });
          if (typeof ret === "function") off = ret;
        } catch {
          highlightWatches.delete(id);
          continue;
        }
        if (destroyed || gone) {
          highlightWatches.delete(id);
          try { off(); } catch { /* board already gone */ }
          continue;
        }
        highlightWatches.set(id, off);
      }
    }
    for (const id of [...highlightWatches.keys()]) {
      if (!live.has(id)) disposeHighlightWatch(id);
    }
  };
  highlightWatchReady = true;
  syncHighlightWatches();

  // ---- write pipeline ----
  const fieldsOf = (op) => {
    if (op.op === "create") {
      const out = [["parent", op.parent]];
      if (op.props?.plexus !== undefined) out.push(["props", stable(op.props.plexus)]);
      return out;
    }
    if (op.op === "move") return [["parent", op.parent]];
    if (op.op === "delete") return [["parent", ""]];
    if (op.op === "props") return [["props", stable(op.plexus)]];
    if (op.op === "string") return [["string", op.string]];
    return [];
  };
  const settleOp = (op) => { for (const [f] of fieldsOf(op)) ledger.settle(op.uid, f); };

  async function runOp(op) {
    switch (op.op) {
      case "create":
        await host.createBlock({ parentUid: op.parent, order: op.order, uid: op.uid, string: op.string, props: op.props, open: op.open });
        break;
      case "move": await host.moveBlock(op.uid, op.parent, op.order); break;
      case "delete": await host.deleteBlock(op.uid); break;
      case "props": await host.updateProps(op.uid, op.plexus); break;
      case "string": await host.updateString(op.uid, op.string); break;
      case "open": await host.setOpen(op.uid, op.open); break;
      case "page": await host.createPage({ uid: op.uid, title: op.title }); break;
      default: break;
    }
  }

  async function runOpWithRetry(op) {
    let last = null;
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
      setSyncState(attempt === 0 ? "writing" : "retrying");
      try {
        await runOp(op);
        return;
      } catch (err) {
        last = err;
      }
    }
    throw last;
  }

  // F10. A long write list pauses between batches while Roam's sync dot says it is saving, at most SYNC_HOLD_CAP_MS
  // in all for one transaction (never when the dot is missing or the browser is offline). Only a commit holds; an
  // undo, a redo and a migration never wait. While it waits the host's undo group is closed (`suspend`): the batches
  // are separate native groups, so another session's writes cannot join this one and a foreign edit still
  // invalidates the log. A custom undo entry cannot be split, so its group stays open.
  const holder = syncHold || (typeof document === "undefined" ? null : createSyncHold());
  async function execute(list, { hold = false, suspend = false } = {}) {
    let i = 0;
    let budget = SYNC_HOLD_CAP_MS;
    try {
      for (; i < list.length; i++) {
        if (hold && holder && budget > 0 && i > 0 && i % SYNC_HOLD_BATCH === 0 && list.length > SYNC_HOLD_BATCH) {
          let held = false;
          let resume = null;
          try {
            const out = await holder.wait({
              capMs: budget,
              abort: () => destroyed,
              keepGuard: true,
              onHold: () => { held = true; setSyncState("held"); if (suspend) resume = host.suspendGroup?.() ?? null; },
            });
            if (out && Number.isFinite(out.waited)) budget -= out.waited;
          } catch { /* a failed look fails open */ }
          if (resume) resume();
          if (held) setSyncState("writing");
        }
        await runOpWithRetry(list[i]);
        settleOp(list[i]);
      }
      if (list.length) setSyncState("idle");
    } catch (err) {
      for (let j = i; j < list.length; j++) settleOp(list[j]);
      throw err;
    } finally {
      holder?.release?.();
    }
  }

  function coalesce(ops) {
    const out = [];
    const creates = new Map();
    const props = new Map();
    const strings = new Map();
    for (const op of ops) {
      if (op.op === "create") { out.push(op); creates.set(op.uid, op); continue; }
      if (op.op === "props") {
        const c = creates.get(op.uid);
        if (c) { c.props = mergePropsForWrite(c.props, op.plexus); continue; }
        const prev = props.get(op.uid);
        if (prev) { prev.plexus = op.plexus; continue; }
        const next = { ...op };
        props.set(op.uid, next);
        out.push(next);
        continue;
      }
      if (op.op === "string") {
        const c = creates.get(op.uid);
        if (c) { c.string = op.string; continue; }
        const prev = strings.get(op.uid);
        if (prev) { prev.string = op.string; continue; }
        const next = { ...op };
        strings.set(op.uid, next);
        out.push(next);
        continue;
      }
      out.push(op);
    }
    return out;
  }

  function handleFailure(err) {
    console.error("[plexus session] write failed", err);
    ledger.clear();
    setSyncState("failed");
    emit("toast", { message: "Couldn't save changes to Roam. Reloaded the board from the graph." });
    repull();
  }

  // One user operation is one Roam undo step: the host groups the writes of a transaction.
  const grouped = (fn) => (host.group ? host.group(fn) : fn());

  // A virtual board is stamped with the board marker by its first write, in the same group as that write.
  // The props op merges into any props op the transaction already holds for the board (coalesce keeps the last one).
  // Folds the outline once, like Enhance, when the collapse setting is on.
  function stampBoard(ops) {
    if (!board?.virtual) return;
    const held = ops.filter((op) => op.op === "props" && op.uid === uid);
    if (held.length) {
      const last = held[held.length - 1];
      if (last.plexus?.native === true) return; // Restore native is the user choosing native: no stamp
      last.plexus = withBoardMarker(last.plexus, true);
      rawProps(uid, last.plexus);
    } else {
      const plexus = withBoardMarker(rawPlexus(uid), true);
      ops.unshift({ op: "props", uid, plexus });
      rawProps(uid, plexus);
    }
    if (collapseOutline() && raw?.[OPEN] !== false) {
      ops.push({ op: "open", uid, open: false });
      raw[OPEN] = false;
    }
  }

  // For writes that do not go through txn: the stamp ops (empty unless the board is virtual), already in the model.
  function stampList() {
    const ops = [];
    stampBoard(ops);
    if (!ops.length) return ops;
    for (const op of ops) for (const [f, v] of fieldsOf(op)) ledger.expect(op.uid, f, v);
    publish();
    return ops;
  }

  const stampedRun = (list, fn) => queue.run(() => grouped(async () => {
    await execute(list);
    return fn();
  }));

  // F12. True when `n` planned writes may go to Roam: under the confirm line always, under the refuse line when
  // the user says yes. A no shows one toast. The caller drops the change (a transaction repulls the board).
  const askBulk = (n) => {
    if (typeof confirmBulk === "function") return confirmBulk(n) === true;
    const ask = globalThis.confirm;
    if (typeof ask !== "function") return true;
    try { return ask(`This change writes ${n} blocks to Roam at once. Roam syncs them one by one and can stall on thousands. Continue?`) === true; } catch { return false; }
  };
  function bulkAllowed(n) {
    if (!(n > BULK_CONFIRM_WRITES)) return true;
    if (n > BULK_REFUSE_WRITES) {
      emit("toast", { message: `Plexus refused ${n} writes in one change: too many for Roam's sync. Split it into smaller steps.` });
      return false;
    }
    let ok = false;
    try { ok = askBulk(n); } catch { ok = false; }
    if (!ok) emit("toast", { message: `Cancelled ${n} writes.` });
    return ok;
  }

  function commit(ops, result, custom = null) {
    if (!ops.length) return Promise.resolve(result);
    stampBoard(ops);
    const list = coalesce(ops);
    if (!bulkAllowed(list.length)) {
      // The optimistic model already holds the change: read the board back from Roam.
      repull();
      return Promise.resolve(undefined);
    }
    for (const op of list) for (const [f, v] of fieldsOf(op)) ledger.expect(op.uid, f, v);
    publish();
    if (custom) custom.forward = list;
    return queue.run(() => grouped(async () => {
      if (custom) host.setCustomUndo?.(custom);
      try {
        return await execute(list, { hold: true, suspend: !custom });
      } catch (err) {
        // The inverse covers the whole list, but only part of it ran: close as a native chunk of what did.
        if (custom) host.setCustomUndo?.(null);
        throw err;
      }
    })).then(() => result, (err) => { handleFailure(err); return result; });
  }

  function txn(fn, custom = null) {
    if (!board || destroyed || gone) return Promise.resolve(undefined);
    const ops = [];
    const t = {
      create({ parent, uid: id, string = "", plexus, open, order }) {
        const newUid = id ?? host.generateUid();
        const ord = order ?? insertOrder(parent);
        const node = { [UID]: newUid, [STR]: string, [ORD]: 0, [KIDS]: [] };
        if (plexus) node[PROPS] = { plexus: plainKeys(plexus) };
        if (open !== undefined) node[OPEN] = open;
        rawInsert(parent, node, ord);
        ops.push({ op: "create", uid: newUid, parent, order: ord, string, props: plexus ? { plexus } : undefined, open });
        return newUid;
      },
      move(id, parent, order = "last") {
        rawMove(id, parent, order);
        ops.push({ op: "move", uid: id, parent, order });
      },
      del(id) {
        rawDelete(id);
        ops.push({ op: "delete", uid: id });
      },
      props(id, plexus) {
        rawProps(id, plexus);
        ops.push({ op: "props", uid: id, plexus });
      },
      string(id, string) {
        rawString(id, string);
        ops.push({ op: "string", uid: id, string });
      },
      open(id, value) {
        const node = rawNode(id);
        if (!node) return;
        const next = value !== false;
        node[OPEN] = next;
        ops.push({ op: "open", uid: id, open: next });
      },
      // A page outside the board. Nothing in the board tree changes.
      page({ uid: id, title }) {
        const newUid = id ?? host.generateUid();
        ops.push({ op: "page", uid: newUid, title });
        return newUid;
      },
      sync: rebuild,
    };
    const result = fn(t);
    return commit(ops, result, custom);
  }

  // ---- layout helpers ----
  const rawPlexus = (id) => readPlexus(rawNode(id)?.[PROPS]) ?? {};

  // Stored x/y means a previous enhance already laid this board out. Auto-placed memory coords do not count.
  function hasStoredLayout() {
    for (const item of board.items.values()) {
      const stored = readPlexus(rawNode(item.uid)?.[PROPS]);
      if (stored && Number.isFinite(stored.x) && Number.isFinite(stored.y)) return true;
    }
    return false;
  }

  function itemPlexus(id, patch) {
    const item = board.items.get(id);
    const base = rawPlexus(id);
    const merged = { ...base, type: item?.type ?? base.type, ...patch };
    const known = serializeItemLayout(merged);
    return { ...unknownKeys(base, ITEM_KEYS), ...known };
  }

  function edgePlexus(id, patch) {
    const base = rawPlexus(id);
    const merged = { ...normalizeEdge(base), ...patch };
    return { ...unknownKeys(base, EDGE_KEYS), ...serializeEdge(merged) };
  }

  const clampSize = (type, w, h) => ({
    w: Math.max(MIN_SIZES[type]?.w ?? 1, w),
    h: Math.max(MIN_SIZES[type]?.h ?? 1, h),
  });

  // A section never goes below its members: keeps the frame's origin and grows the size to their padded far edges.
  const sectionFloor = (id, size) => {
    const item = board.items.get(id);
    const own = rects.get(id);
    if (item?.type !== "section" || !own || !item.members.length) return size;
    const b = boundsOf(item.members.map((m) => rects.get(m)).filter(Boolean));
    if (!b) return size;
    return { w: Math.max(size.w, b.x + b.w + FIT_PAD - own.x), h: Math.max(size.h, b.y + b.h + FIT_PAD - own.y) };
  };

  function ensureContainer(t) {
    if (board.containerUid) return board.containerUid;
    const existing = kidsOf(raw).find((k) => readPlexus(k[PROPS])?.type === "edges");
    if (existing) return existing[UID];
    return t.create({ parent: uid, order: "last", string: "Connections", plexus: { type: "edges" }, open: false });
  }

  // The region block under the card's source image (a ((ref)) card writes under the referenced image).
  // Returns its uid, or null after a toast when the card is not an image or the image is read-only.
  function writeImageRegion(t, item, frac, label, regionUid, poly) {
    const read = (id) => {
      try { return host.blockString?.(id); } catch { return null; }
    };
    const source = imageSourceOf(item, read);
    if (!source.ok) {
      emit("toast", { message: source.reason === "unread" ? "That image is on a page you can't edit." : "That card is not an image." });
      return null;
    }
    if (source.viaRef && typeof host.canEdit === "function") {
      let writable = true;
      try { writable = host.canEdit(source.uid) !== false; } catch { writable = false; }
      if (!writable) {
        emit("toast", { message: "That image is on a page you can't edit." });
        return null;
      }
    }
    const found = regionsContainerOf(item, source);
    const caption = regionCaption(label, found.count);
    const string = Array.isArray(poly) && poly.length >= 3
      ? imagePolyString(source.uid, poly, caption)
      : imageRegionString(source.uid, frac, caption);
    if (!string) return null;
    const parent = found.container || t.create({
      parent: source.uid,
      order: "last",
      string: CONTAINER_STRING,
      plexus: { type: "regions" },
      open: false,
    });
    return t.create({ parent, uid: regionUid, order: "last", string });
  }

  const REGION_REF_QUERY = "[:find ?ref :in $ ?u :where [?b :block/uid ?u] [?r :block/refs ?b] [?r :block/uid ?ref]]";

  function readBlock(id) {
    try { return host.blockString?.(id) || ""; } catch { return ""; }
  }

  // An image region we wrote (k=img) or a Roam Plexus image region (k=imgpoly / k=imgrect).
  // A pin is not one of these.
  function imageRegionBlock(id) {
    const region = parseRegion(readBlock(id));
    if (!region || region.error || !region.drawingUid) return null;
    if (region.kind === "img" && region.supported) return region;
    if (region.kind === "imgpoly" || region.kind === "imgrect") return region;
    return null;
  }

  // A child with any text keeps the region. A failed read keeps it too.
  function regionHasNotes(id) {
    let kids = null;
    try { kids = host.pullTree?.(id, 1, 40); } catch { return true; }
    if (!Array.isArray(kids)) return true;
    return kids.some((kid) => String(kid?.string ?? "").trim() !== "");
  }

  // null means the query failed: the caller keeps the region. Edge uids in `ignore` do not count.
  function foreignRefs(id, ignore) {
    if (typeof host.q !== "function") return null;
    let rows = null;
    try { rows = host.q(REGION_REF_QUERY, id); } catch { return null; }
    if (!Array.isArray(rows)) return null;
    const out = [];
    for (const row of rows) {
      const ref = Array.isArray(row) ? row[0] : row;
      if (typeof ref !== "string" || !ref || ref === id || ignore.has(ref)) continue;
      out.push(ref);
    }
    return out;
  }

  function containerHolding(regionUid, drawingUid) {
    let nodes = [];
    try { nodes = host.pullTree?.(drawingUid, 2, 80) || []; } catch { nodes = []; }
    if (!Array.isArray(nodes)) return null;
    for (const node of nodes) {
      if (!isContainerString(node?.string)) continue;
      const kids = node.children || [];
      if (kids.some((kid) => kid?.uid === regionUid)) return { uid: node.uid, kids };
    }
    return null;
  }

  // Deletes the edges, then each image-region endpoint nothing else still uses.
  // `force` deletes those regions even when another block references them (the user deleted the region).
  function removeEdges(t, uids, { force } = {}) {
    const drop = new Set();
    for (const id of uids || []) if (board.edges.has(id)) drop.add(id);
    let grew = true;
    while (grew) {
      grew = false;
      for (const edge of board.edges.values()) {
        if (drop.has(edge.uid)) continue;
        if (drop.has(edge.from) || drop.has(edge.to)) { drop.add(edge.uid); grew = true; }
      }
    }
    const forced = force instanceof Set ? force : new Set();
    const candidates = new Set(forced);
    for (const id of drop) {
      const edge = board.edges.get(id);
      if (edge?.fromBlock) candidates.add(edge.fromBlock);
      if (edge?.toBlock) candidates.add(edge.toBlock);
    }
    const used = new Set();
    for (const edge of board.edges.values()) {
      if (drop.has(edge.uid)) continue;
      if (edge.fromBlock) used.add(edge.fromBlock);
      if (edge.toBlock) used.add(edge.toBlock);
    }
    const doomed = new Set();
    for (const regionUid of candidates) {
      if (!imageRegionBlock(regionUid)) continue;
      if (!forced.has(regionUid) && used.has(regionUid)) continue;
      if (!forced.has(regionUid)) {
        if (regionHasNotes(regionUid)) continue;
        const refs = foreignRefs(regionUid, drop);
        if (refs === null || refs.length) continue;
      }
      doomed.add(regionUid);
    }
    const containers = new Set();
    for (const regionUid of doomed) {
      const region = imageRegionBlock(regionUid);
      const home = region ? containerHolding(regionUid, region.drawingUid) : null;
      if (!home?.uid) continue;
      const leftover = (home.kids || []).filter((kid) => kid?.uid && !doomed.has(kid.uid));
      if (!leftover.length) containers.add(home.uid);
    }
    for (const id of drop) t.del(id);
    for (const id of doomed) t.del(id);
    for (const id of containers) t.del(id);
  }

  function ensureTrails(t) {
    if (board.trailsUid) return board.trailsUid;
    const existing = kidsOf(raw).find((k) => readPlexus(k[PROPS])?.type === "trails");
    if (existing) return existing[UID];
    return t.create({ parent: uid, order: "last", string: "Trails", plexus: { type: "trails" }, open: false });
  }

  function trailByUid(id) {
    return (board.trails || []).find((tr) => tr.uid === id) || null;
  }

  function refOf(id) {
    const item = board.items.get(id);
    return item ? semanticRef(item) : `((${id}))`;
  }

  function edgeStringFor(from, to, dir, label, srcBlock, dstBlock) {
    return edgeString({ srcRef: refOf(from), dstRef: refOf(to), dir, label, srcBlock, dstBlock });
  }

  // The {{[[plexus-regions]]}} child of the source image, plus how many image regions it already holds.
  function regionsContainerOf(item, source) {
    let nodes = [];
    try { nodes = host.pullTree?.(source.uid, 2, 200) || []; } catch { nodes = []; }
    if (!nodes.length && source.uid === item?.uid) nodes = item.content || [];
    let container = null;
    let count = 0;
    for (const node of nodes || []) {
      const string = node?.[":block/string"] ?? node?.string ?? "";
      if (!isContainerString(string)) continue;
      container = node[":block/uid"] ?? node.uid ?? null;
      const kids = node?.[":block/children"] ?? node?.children ?? [];
      for (const kid of kids) {
        if (endpointKindOf(kid?.[":block/string"] ?? kid?.string ?? "") === "region") count += 1;
      }
      break;
    }
    return { container, count };
  }

  // ---- auto-fit ----
  // Grows auto-fit sections around the touched items (grow only), all inside the caller's txn. Grown sections
  // are written relative to their parent's final rect; direct members of a section whose origin moved are
  // rebased so their world positions stay put (this overwrites their earlier write in the same txn).
  function applyFit(t, touched, { skip } = {}) {
    if (!flag("auto-fit-sections", true)) return;
    const list = [...(touched ?? [])];
    if (!list.length) return;
    t.sync();
    const plan = sectionFitPlan(board, rects, list, skip ? { skip: new Set(skip) } : {});
    if (!plan.length) return;
    const grown = new Map(plan.map((p) => [p.uid, p.rect]));
    const finalWorld = new Map(rects);
    for (const [sid, r] of grown) finalWorld.set(sid, r);
    const originOf = (pid) => (pid === uid ? { x: 0, y: 0 } : finalWorld.get(pid) ?? { x: 0, y: 0 });
    for (const [sid, r] of grown) {
      const p = originOf(board.items.get(sid).parentUid);
      t.props(sid, itemPlexus(sid, { x: round1(r.x - p.x), y: round1(r.y - p.y), w: round1(r.w), h: round1(r.h) }));
    }
    for (const [sid, r] of grown) {
      const old = rects.get(sid);
      if (Math.abs(r.x - old.x) < 0.01 && Math.abs(r.y - old.y) < 0.01) continue;
      for (const m of board.items.get(sid).members) {
        if (grown.has(m)) continue;
        const mr = rects.get(m);
        const nx = round1(mr.x - r.x);
        const ny = round1(mr.y - r.y);
        // Only a member whose stored position changes is written.
        const stored = rawPlexus(m);
        if (stored.x === nx && stored.y === ny) continue;
        t.props(m, itemPlexus(m, { x: nx, y: ny }));
      }
    }
  }

  // Pushes overlapping siblings of just-moved items apart. Sections only take part when a section moved.
  function spaceOutAfter(t, moved) {
    t.sync();
    const byParent = new Map();
    for (const id of moved) {
      const it = board.items.get(id);
      if (!it) continue;
      if (!byParent.has(it.parentUid)) byParent.set(it.parentUid, []);
      byParent.get(it.parentUid).push(id);
    }
    const displacedIds = [];
    for (const [pid, here] of byParent) {
      const sibs = pid === uid ? board.roots : board.items.get(pid)?.members ?? [];
      const withSections = here.some((id) => board.items.get(id).type === "section");
      const map = new Map();
      const pinned = new Set();
      for (const s of sibs) {
        const it = board.items.get(s);
        if (!it || (it.type === "section" && !withSections)) continue;
        map.set(s, rects.get(s));
        if (it.pinned && !here.includes(s)) pinned.add(s);
      }
      const origin = pid === uid ? { x: 0, y: 0 } : rects.get(pid) ?? { x: 0, y: 0 };
      for (const d of spaceOutRects(map, new Set(here), { fixed: pinned })) {
        t.props(d.uid, itemPlexus(d.uid, { x: round1(d.x - origin.x), y: round1(d.y - origin.y) }));
        displacedIds.push(d.uid);
      }
    }
    applyFit(t, displacedIds);
  }

  const withCardLook = (layout, string) => {
    const look = lookForNewString(string, setting("default-card-look", "block"));
    return look ? { ...layout, look } : layout;
  };

  const cardAt = (t, string, x, y, size = null) => {
    const parent = containerAt(board, { x: x + (size?.w ?? DEFAULT_SIZES.card.w) / 2, y: y + (size?.h ?? DEFAULT_SIZES.card.h) / 2 }, { rects });
    const rel = toRelative(board, parent, { x, y }, rects);
    const layout = withCardLook({ x: rel.x, y: rel.y }, string);
    if (Number.isFinite(size?.w)) layout.w = size.w;
    if (Number.isFinite(size?.h)) layout.h = size.h;
    return t.create({ parent, string, plexus: serializeItemLayout(layout) });
  };

  const defaultSizeFor = (item) => {
    if (item.type === "section") return DEFAULT_SIZES.section;
    if (item.type === "text") return DEFAULT_SIZES.text;
    if (item.kind === "board") return DEFAULT_BOARD_CARD;
    if (item.kind === "pdf") return DEFAULT_SIZES.pdf;
    return { w: sizeSetting("default-card-width", DEFAULT_SIZES.card.w), h: sizeSetting("default-card-height", DEFAULT_SIZES.card.h) };
  };

  // ---- links ----
  // Cards only. Page refs key on the title; every other card keys on its target uid.
  function linkRefKey(b) {
    if (!b) return "";
    const parts = [];
    for (const item of b.items.values()) {
      if (item.type !== "card" || !item.target) continue;
      const t = item.target;
      parts.push(t.kind === "page" ? `p:${t.title ?? ""}` : `u:${t.uid ?? ""}`);
    }
    parts.sort();
    return parts.join("\n");
  }

  function recomputeLinks(force) {
    if (!board) return;
    const filtered = filterLinks(allLinks, linkMode);
    const res = coveredBy(filtered, board);
    const fp = `${linkMode}|${res.visible.map((l) => l.key).join(",")}|${[...res.coveredEdges].sort().join(",")}`;
    const changed = fp !== linkFingerprint;
    visibleLinks = res.visible;
    covered = res.coveredEdges;
    linkFingerprint = fp;
    if (changed || force) emit("links", { links: visibleLinks, coveredEdges: covered });
  }

  // Card eids by item, the board eid, and the distinct ref eids, or null when there is nothing to link.
  function linkInputs() {
    if (!board) return null;
    // One lookup per distinct ref. Two cards that share a page do not ask twice.
    const resolved = new Map();
    const resolveOnce = (ref) => {
      const key = ref.title != null ? `title:${ref.title}` : `uid:${ref.uid}`;
      if (resolved.has(key)) return resolved.get(key);
      const eid = host.resolveEid(ref);
      resolved.set(key, eid);
      return eid;
    };
    const boardEid = resolveOnce({ uid });
    const eidToItems = new Map();
    for (const item of board.items.values()) {
      if (item.type !== "card") continue;
      const t = item.target;
      const ref = t.kind === "page" ? { title: t.title } : { uid: t.uid };
      const eid = resolveOnce(ref);
      if (eid == null || eid === boardEid) continue;
      if (!eidToItems.has(eid)) eidToItems.set(eid, []);
      eidToItems.get(eid).push(item.uid);
    }
    const eids = [...eidToItems.keys()];
    if (!eids.length || boardEid == null) return null;
    return { boardEid, eidToItems, eids, eidSet: new Set(eids) };
  }
  function linkRows(inputs, targets) {
    if (typeof host.linkRows === "function") return host.linkRows(inputs.boardEid, inputs.eidSet, targets) || [];
    return host.q(linksQuery(), inputs.boardEid, inputs.eids, targets) || [];
  }
  function finishLinkRows(inputs, rows) {
    const parentStrings = new Map();
    let budget = MAX_PARENT_STRINGS;
    for (const row of rows) {
      const su = row[2];
      const ss = row[3];
      // host.linkRows brings the parent string with the row (null: none); only linksQuery() rows need the read.
      if (row.length > 4) {
        if (row[4] != null && attrNameOf(ss) == null) parentStrings.set(su, row[4]);
        continue;
      }
      if (budget <= 0) continue;
      if (attrNameOf(ss) == null && !parentStrings.has(su)) {
        budget--;
        const ps = host.parentString?.(su);
        if (ps != null) parentStrings.set(su, ps);
      }
    }
    allLinks = reduceLinks(rows, { eidToItems: inputs.eidToItems, parentStrings });
  }
  let linkTimer = null;
  let linkIdleId = null;
  let linkEpoch = 0;
  let linkPromise = null;
  let linkResolve = null;
  function finishLinks() {
    const done = linkResolve;
    linkPromise = null;
    linkResolve = null;
    done?.();
  }
  function runLinks() {
    linkTimer = null;
    linkIdleId = null;
    if (!destroyed) {
      let inputs = null;
      try { inputs = linkInputs(); } catch (err) { console.error("[plexus session] links", err); }
      const ric = globalThis.requestIdleCallback;
      // A big board (PhD main board: ~1,000 card eids, one 1.7 s query) reads its link rows LINK_CHUNK targets
      // per idle slice; the links publish once, after the last slice.
      if (inputs && inputs.eids.length > LINK_CHUNK && typeof ric === "function" && !idle && notedSpeedFlags().bgBudget !== false) {
        const epoch = linkEpoch;
        const rows = [];
        let i = 0;
        let partMs = 25;
        const clock = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());
        linkJob = sharedBgBudget().run(() => {
          if (destroyed || epoch !== linkEpoch) { linkJob = null; finishLinks(); return true; }
          try {
            const t0 = clock();
            rows.push(...linkRows(inputs, inputs.eids.slice(i, i + LINK_PART)));
            partMs = (partMs + (clock() - t0)) / 2;
            i += LINK_PART;
            if (i < inputs.eids.length) return false;
            finishLinkRows(inputs, rows);
            recomputeLinks(false);
          } catch (err) { console.error("[plexus session] links", err); }
          linkJob = null;
          finishLinks();
          return true;
        }, { timeout: 1000, firstQuiet: LINK_QUIET_MS, partMs: () => partMs, label: "links" });
        return;
      }
      if (inputs && inputs.eids.length > LINK_CHUNK && typeof ric === "function" && !idle) {
        const epoch = linkEpoch;
        const rows = [];
        let i = 0;
        const step = () => {
          linkIdleId = null;
          if (destroyed || epoch !== linkEpoch) { finishLinks(); return; }
          try {
            rows.push(...linkRows(inputs, inputs.eids.slice(i, i + LINK_CHUNK)));
            i += LINK_CHUNK;
            if (i < inputs.eids.length) { linkIdleId = ric(step, { timeout: 1000 }); return; }
            finishLinkRows(inputs, rows);
            recomputeLinks(false);
          } catch (err) { console.error("[plexus session] links", err); }
          finishLinks();
        };
        step();
        return;
      }
      try {
        if (inputs) finishLinkRows(inputs, linkRows(inputs, inputs.eids));
        else allLinks = [];
        recomputeLinks(false);
      } catch (err) { console.error("[plexus session] links", err); }
    }
    finishLinks();
  }
  // One rAF chain is in flight at a time. A hidden tab pauses frames, and every board change used to queue
  // another pair of closures behind the paused ones.
  let linkChain = null;
  let linkJob = null;
  let linksOwed = false;
  const linksParked = () => holders > 0 && pausedHolds >= holders;
  function parkLinks() {
    if (!linkJob && !linkChain && linkTimer == null && linkIdleId == null) return;
    cancelScheduledLinks();
    linksOwed = true;
  }
  function unparkLinks() {
    if (!linksOwed || linksParked() || destroyed) return;
    linksOwed = false;
    scheduleLinks();
  }
  function cancelScheduledLinks(keepChain = false) {
    linkEpoch += 1;
    if (linkJob) { const stop = linkJob; linkJob = null; stop(); }
    if (!keepChain) linkChain = null;
    if (linkTimer) clearTimeout(linkTimer);
    linkTimer = null;
    if (linkIdleId != null) {
      try { globalThis.cancelIdleCallback?.(linkIdleId); } catch { /* already gone */ }
      linkIdleId = null;
    }
  }
  // The board is already published. Two frames let a sketch handoff mount
  // .pxd-item before this query; the idle timeout is 1s so the curves still show.
  function scheduleLinks() {
    cancelScheduledLinks(true);
    // A parked board (page left, crumb park) spends no background budget: the links run again when it resumes.
    if (linksParked()) { linksOwed = true; linkChain = null; return; }
    const ric = globalThis.requestIdleCallback;
    const raf = globalThis.requestAnimationFrame;
    if (linkDelay !== 0 && !idle && typeof ric === "function" && typeof raf === "function") {
      if (linkChain) {
        linkChain.epoch = linkEpoch;
        return;
      }
      const chain = { epoch: linkEpoch };
      linkChain = chain;
      const live = () => linkChain === chain && chain.epoch === linkEpoch && !destroyed;
      raf(() => {
        if (!live()) { if (linkChain === chain) linkChain = null; return; }
        raf(() => {
          if (!live()) { if (linkChain === chain) linkChain = null; return; }
          // From here the idle callback is the pending work; a later schedule cancels it and starts a new chain.
          linkChain = null;
          linkIdleId = ric(() => {
            if (chain.epoch !== linkEpoch) return;
            linkIdleId = null;
            runLinks();
          }, { timeout: 1000 });
        });
      });
      return;
    }
    linkChain = null;
    const epoch = linkEpoch;
    linkTimer = setTimeout(() => {
      if (epoch !== linkEpoch) return;
      linkTimer = null;
      runIdle(runLinks);
    }, linkDelay);
    linkTimer.unref?.();
  }
  function refreshLinks() {
    if (destroyed) return Promise.resolve();
    if (linkMode === "off") return Promise.resolve();
    if (!linkPromise) linkPromise = new Promise((resolve) => { linkResolve = resolve; });
    scheduleLinks();
    return linkPromise;
  }

  // Reads lastAction after the group closes (closeChunk runs in group()'s finally).
  const runParsed = (fn) => queue.run(async () => {
    try {
      const res = await grouped(fn);
      if (!res || res.ok === false) return res;
      const writes = Number.isInteger(res.writes) ? res.writes : (host.stats.lastAction?.writes ?? 0);
      return { ...res, writes };
    } catch (err) {
      handleFailure(err);
      return { ok: false, reason: "write-failed" };
    }
  });

  const placeParsed = (x, y, w, h) => {
    const parent = containerAt(board, { x: x + w / 2, y: y + h / 2 }, { rects });
    const rel = toRelative(board, parent, { x, y }, rects);
    return { parent, rel };
  };

  // Footnotes of a parsed insert, in the Footnotes extension's format. `strings` hold the model's
  // tokens (footnotes.js). Reads the page that holds the board, writes the header (and its rule) when
  // missing plus one block per note, and returns { apply(string), notes } for the content that follows.
  // Call inside runParsed so the notes share the insert's undo group. `reserve` is the writes the
  // content itself will spend; everything stays within the 45-write budget.
  const footnoteFormatNow = () => footnoteFormat(setting("parse-footnote-format", "extension"));
  const settleFootnotes = async (strings, { anchor, reserve = 0, defs } = {}) => {
    const list = strings.map((s) => String(s ?? ""));
    const hasDefs = defs && Object.keys(defs).length > 0;
    if (!hasDefs && !hasFootnoteTokens(list)) return null;
    if (footnoteFormatNow() !== "extension") return plainFootnotes(list, { defs });
    const pageUid = (anchor && host.blockPageUid?.(anchor)) || host.blockPageUid?.(uid) || "";
    const state = pageUid ? host.footnoteState?.(pageUid, FOOTNOTES_HEADER) : null;
    const headerWrites = state && !state.headerUid ? 2 : 0;
    const cap = state ? Math.max(0, Math.min(FOOTNOTE_CAP, WRITE_BUDGET - reserve - headerWrites)) : 0;
    const plan = planFootnotes(list, {
      startAt: state ? Math.max(state.max, state.count) : 0,
      cap,
      defs,
      uid: () => host.generateUid(),
    });
    if (plan.notes.length) {
      let header = state.headerUid;
      if (!header) {
        await host.createBlock({ parentUid: pageUid, order: "last", string: "---" });
        header = host.generateUid();
        await host.createBlock({ parentUid: pageUid, order: "last", uid: header, string: FOOTNOTES_HEADER, viewType: "numbered" });
      }
      for (const note of plan.notes) {
        await host.createBlock({ parentUid: header, order: "last", uid: note.uid, string: note.text });
      }
    }
    if (plan.overflow.length) {
      emit("toast", { message: state
        ? `${plan.overflow.length} footnote${plan.overflow.length === 1 ? "" : "s"} kept as plain (N) lines (Roam undo holds 50 changes)`
        : "Footnotes kept as plain (N) lines (no page to hold them)" });
    }
    return plan;
  };

  // Reads the PDF block's region children. One group: the caller is already inside runParsed.
  async function writePdfPin(spec) {
    if (!spec?.pdfUid || !Array.isArray(spec.frac)) return { uid: "", reused: false };
    let kids = [];
    try {
      const raw = host.pullTree?.(spec.pdfUid, 2, 200);
      const list = raw && typeof raw.then === "function" ? await raw : raw;
      if (Array.isArray(list)) kids = list;
    } catch { kids = []; }
    // Dedupe reads every container (old pins sit under plexus-regions); new pins go under plexus-pins.
    const boxes = kids.filter((kid) => isContainerString(kid?.string));
    const container = boxes.find((kid) => String(kid?.string || "").trim() === PIN_CONTAINER_STRING) || null;
    const regions = [];
    for (const box of boxes) {
      for (const child of box?.children || []) {
        const region = parseRegion(child?.string || "");
        if (!region) continue;
        if (child?.uid) region.uid = child.uid;
        regions.push(region);
      }
    }
    const plan = planPinWrites({
      ...spec,
      regions,
      containerUid: container?.uid || "",
      pinUid: host.generateUid(),
    });
    if (plan.reused) return { uid: plan.uid, reused: true };
    let containerUid = container?.uid || "";
    let pinUid = plan.uid;
    for (const step of plan.creates) {
      const parentUid = step.role === "pin" && !step.parentUid ? containerUid : step.parentUid;
      if (!parentUid) return { uid: "", reused: false };
      const made = await host.createBlock({
        parentUid,
        order: "last",
        uid: step.uid || undefined,
        string: step.string,
        open: step.open,
        props: step.props,
      });
      const id = typeof made === "string" ? made : made?.uid || step.uid || "";
      if (step.role === "container") containerUid = id;
      if (step.role === "pin") pinUid = id || pinUid;
    }
    return { uid: pinUid, reused: false };
  }
  async function citePin(parentUid, pin) {
    if (!parentUid || !pin) return "";
    const made = await writePdfPin(pin);
    if (!made.uid) return "";
    const string = sourceAttrString(made.uid);
    if (!string) return made.uid;
    await host.createBlock({ parentUid, order: "last", string });
    return made.uid;
  }

  // Folded height is session memory. A resize while children are open is the unfolded size only.
  const kidsMemory = new Map();

  // ---- session object ----
  const session = {
    uid,
    host,
    settings,
    get board() { return board; },
    get gone() { return gone; },
    get rects() { return rects; },
    get links() { return visibleLinks; },
    get linksPromise() { return linkPromise ?? Promise.resolve(); },
    get coveredEdges() { return covered; },
    get busy() { return busy; },
    get linkMode() { return linkMode; },

    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
      return () => listeners.get(name)?.delete(fn);
    },

    // The view calls this with the card uid while that card is open, and null when editing ends.
    setEditing(id) {
      editingUid = typeof id === "string" && id ? id : null;
    },

    idle: () => queue.idle(),

    setLinkMode(mode) {
      if (!LINK_MODES.includes(mode)) return;
      linkMode = mode;
      recomputeLinks(true);
      if (mode !== "off" && !allLinks.length) refreshLinks();
    },
    refreshLinks,

    commitMove(uids, dx, dy) {
      if (!board || (!dx && !dy)) return Promise.resolve();
      return txn((t) => {
        const top = topLevelOf(board, uids).filter((id) => !board.items.get(id).pinned);
        if (!top.length) return;
        const moved = new Map(rects);
        for (const id of top) {
          const r = rects.get(id);
          moved.set(id, { ...r, x: r.x + dx, y: r.y + dy });
        }
        const plan = new Map(membershipPlan(board, top, moved).map((p) => [p.uid, p]));
        for (const id of top) {
          const item = board.items.get(id);
          const p = plan.get(id);
          if (p) {
            t.move(id, p.toParent, "last");
            t.props(id, itemPlexus(id, { x: p.x, y: p.y }));
          } else {
            t.props(id, itemPlexus(id, { x: item.x + dx, y: item.y + dy }));
          }
        }
        applyFit(t, top);
        if (flag("space-out", false)) spaceOutAfter(t, top);
      });
    },

    commitRects(list) {
      if (!board || !list?.length) return Promise.resolve();
      return txn((t) => {
        const changedSections = [];
        const fitTouched = [];
        for (const r of list) {
          const item = board.items.get(r.uid);
          if (!item || item.pinned) continue;
          fitTouched.push(r.uid);
          const parentRect = item.parentUid === uid ? { x: 0, y: 0 } : rects.get(item.parentUid) ?? { x: 0, y: 0 };
          const size = clampSize(item.type, r.w ?? item.w, r.h ?? item.h);
          if (item.type === "card" && item.kids && round1(size.h) !== round1(item.h)) {
            kidsMemory.set(r.uid, rememberUnfoldedSize(kidsMemory.get(r.uid), round1(size.h)));
          }
          t.props(r.uid, itemPlexus(r.uid, {
            x: round1(r.x - parentRect.x),
            y: round1(r.y - parentRect.y),
            w: round1(size.w),
            h: round1(size.h),
          }));
          if (item.type === "section") changedSections.push(r.uid);
        }
        if (changedSections.length) {
          t.sync();
          for (const sid of changedSections) {
            const plan = sectionAdoptPlan(board, sid, rects);
            for (const p of plan) {
              t.move(p.uid, p.toParent, "last");
              t.props(p.uid, itemPlexus(p.uid, { x: p.x, y: p.y }));
            }
            if (plan.length) t.sync();
          }
        }
        applyFit(t, fitTouched, { skip: changedSections });
      });
    },

    addPublicCard({ string, x, y } = {}) {
      return txn((t) => addPublicCard({
        string,
        x,
        y,
        boardUid: uid,
        create: (op) => t.create({
          parent: op.parent,
          string: op.string,
          plexus: serializeItemLayout({ x: op.x, y: op.y }),
        }),
      }));
    },

    createCard({ x, y, string = "", w, h, color, look } = {}) {
      return txn((t) => {
        const size = { w: w ?? DEFAULT_SIZES.card.w, h: h ?? DEFAULT_SIZES.card.h };
        const parent = containerAt(board, { x: x + size.w / 2, y: y + size.h / 2 }, { rects });
        const rel = toRelative(board, parent, { x, y }, rects);
        const layout = withCardLook({ x: rel.x, y: rel.y }, string);
        if (w !== undefined) layout.w = w;
        if (h !== undefined) layout.h = h;
        if (look === "block" || look === "card") layout.look = look;
        const tone = styleColor(color);
        if (tone) layout.color = tone;
        const id = t.create({ parent, string, plexus: serializeItemLayout(layout) });
        applyFit(t, [id]);
        return id;
      });
    },

    createTable({ x, y, w, h } = {}) {
      return txn((t) => {
        const size = { w: w ?? TABLE_SIZE.w, h: h ?? TABLE_SIZE.h };
        const parent = containerAt(board, { x: x + size.w / 2, y: y + size.h / 2 }, { rects });
        const rel = toRelative(board, parent, { x, y }, rects);
        const layout = { x: rel.x, y: rel.y, w: size.w, h: size.h };
        const id = appendTable(t, { parent, plexus: serializeItemLayout(layout) });
        applyFit(t, [id]);
        return id;
      });
    },

    // "extension" (default), "plain" or "off": how a parsed insert writes footnotes.
    footnoteFormat: footnoteFormatNow,

    // Next sibling of the PDF block. No props. Chunks of 400 bullets, 10 chunks max.
    // A PDF that is already a board card gets a note card beside it instead: a sibling
    // under the board would show up as a stray card.
    insertParsedBelow({ pdfUid, markdown, blockEstimate, pin } = {}) {
      if (destroyed || gone) return Promise.resolve(undefined);
      const plan = chunkParsedMarkdown(markdown, blockEstimate);
      if (!plan.ok) {
        emit("toast", { message: PARSE_TOO_LARGE });
        return Promise.resolve({ ok: false, reason: "too-large" });
      }
      if (!plan.chunks.length) return Promise.resolve({ ok: true, uids: [], writes: 0 });
      if (board?.items?.has?.(pdfUid)) {
        const nested = nestMarkdownUnderFirst(markdown);
        if (!String(nested).trim() || bulletCount(nested) === 0) return Promise.resolve({ ok: false, reason: "empty" });
        const item = board.items.get(pdfUid);
        const rect = rects.get(pdfUid) || { x: item?.x || 0, y: item?.y || 0, w: item?.w || DEFAULT_SIZES.card.w, h: item?.h || DEFAULT_SIZES.card.h };
        const size = clampSize("card", DEFAULT_SIZES.card.w, DEFAULT_SIZES.card.h);
        const gap = 40;
        let x = (Number(rect.x) || 0) + (Number(rect.w) || 0) + gap;
        let y = Number(rect.y) || 0;
        const others = [];
        for (const [id, r] of rects) if (id !== pdfUid && r) others.push(r);
        for (let guard = 0; guard < 200; guard += 1) {
          const blocker = others.find((o) => x < o.x + o.w && x + size.w > o.x && y < o.y + o.h && y + size.h > o.y);
          if (!blocker) break;
          y = (Number(blocker.y) || 0) + (Number(blocker.h) || 0) + gap;
        }
        const { parent, rel } = placeParsed(x, y, size.w, size.h);
        const order = insertOrder(parent);
        return runParsed(async () => {
          const fn = await settleFootnotes([markdown], { anchor: pdfUid, reserve: 2 });
          const body = fn ? nestMarkdownUnderFirst(fn.apply(markdown)) : nested;
          if (fn && bulletCount(body) === 0) return { ok: false, reason: "empty" };
          const plexus = serializeItemLayout(withCardLook({ x: rel.x, y: rel.y, w: size.w, h: size.h }, body));
          const roots = await host.fromMarkdown({ parentUid: parent, order, markdown: body });
          const uid = roots[0];
          if (!uid) return { ok: false, reason: "empty" };
          await host.updateProps(uid, plexus);
          if (pin) await citePin(uid, pin);
          repull();
          return { ok: true, uid, uids: [uid], path: "card" };
        });
      }
      const loc = host.blockLocation?.(pdfUid);
      if (!loc) return Promise.resolve({ ok: false, reason: "missing" });
      return runParsed(async () => {
        let order = loc.order + 1;
        const uids = [];
        let chunks = plan.chunks;
        const fn = await settleFootnotes([markdown], { anchor: pdfUid, reserve: plan.chunks.length });
        if (fn) {
          const again = chunkParsedMarkdown(fn.apply(markdown));
          if (again.ok) chunks = again.chunks;
        }
        for (const chunk of chunks) {
          const roots = await host.fromMarkdown({ parentUid: loc.parentUid, order, markdown: chunk });
          uids.push(...roots);
          order = advanceOrder(order, roots.length);
        }
        if (pin && uids[0]) await citePin(uids[0], pin);
        repull();
        return { ok: true, uids };
      });
    },

    // One note card. Children stay in the block tree; kids stays off unless the layout says so.
    insertParsedCard({ x, y, w, h, markdown, pin, sourceUid, sourceUids } = {}) {
      if (!board || destroyed || gone) return Promise.resolve(undefined);
      const nested = nestMarkdownUnderFirst(markdown);
      if (!String(nested).trim() || bulletCount(nested) === 0) return Promise.resolve({ ok: false, reason: "empty" });
      const width = Number.isFinite(w) ? w : DEFAULT_SIZES.card.w;
      const height = Number.isFinite(h) ? h : DEFAULT_SIZES.card.h;
      const size = clampSize("card", width, height);
      const { parent, rel } = placeParsed(x, y, size.w, size.h);
      const order = insertOrder(parent);
      return runParsed(async () => {
        const fn = await settleFootnotes([markdown], { reserve: 2 });
        const body = fn ? nestMarkdownUnderFirst(fn.apply(markdown)) : nested;
        if (fn && bulletCount(body) === 0) return { ok: false, reason: "empty" };
        const plexus = serializeItemLayout(withCardLook({ x: rel.x, y: rel.y, w: size.w, h: size.h }, body));
        const roots = await host.fromMarkdown({ parentUid: parent, order, markdown: body });
        const uid = roots[0];
        if (!uid) return { ok: false, reason: "empty" };
        await host.updateProps(uid, plexus);
        if (pin) await citePin(uid, pin);
        else if (sourceUid && sourceAttrString(sourceUid)) await host.createBlock({ parentUid: uid, order: "last", string: sourceAttrString(sourceUid) });
        // An answer over several parts cites each one: one Source:: child per part.
        for (const extra of Array.isArray(sourceUids) ? sourceUids : []) {
          if (extra && sourceAttrString(extra)) await host.createBlock({ parentUid: uid, order: "last", string: sourceAttrString(extra) });
        }
        repull();
        return { ok: true, uid };
      });
    },

    // auto = grid when Roam Grid can createTableFromModel, otherwise native.
    // grid falls back to native when the API is missing. flat repeats covered cells.
    // notes: the parse's footnote blocks on the table's page ([{ id, mark, text }]) for cell marks.
    // The card is a folded caption block (caption: the parse's table caption, else "Table · N rows") with the table under it.
    insertParsedTable({ x, y, table, mode = "auto", notes, pin, caption } = {}) {
      if (!board || destroyed || gone) return Promise.resolve(undefined);
      const asked = mode === "grid" || mode === "native" || mode === "flat" ? mode : "auto";
      const format = footnoteFormatNow();
      let prep = format === "off" ? { table, notes: [] } : prepareTable(table, notes, { format });
      if (prep.notes.length > WRITE_BUDGET - 8) prep = prepareTable(table, notes, { format: "plain" });
      const defs = {};
      for (const note of prep.notes) defs[note.id] = { mark: note.mark, text: linkSafeText(flattenLine(note.text)) };
      const source = table;
      table = prep.table;
      const rawSize = parsedTableSize(prep.notes.length ? source : table);
      const size = clampSize("card", rawSize.w, rawSize.h);
      const { parent, rel } = placeParsed(x, y, size.w, size.h);
      const plexus = serializeItemLayout({ x: rel.x, y: rel.y, w: size.w, h: size.h });
      const order = insertOrder(parent);
      const tryGrid = asked === "grid" || (asked === "auto" && host.canCreateGridTable?.());
      const captionText = flattenLine(String(caption || "")).trim() || parsedTableCaption(source);
      return runParsed(async () => {
        const card = host.generateUid();
        await host.createBlock({ parentUid: parent, order, uid: card, string: captionText, props: { plexus }, open: false });
        let uid = null;
        let path = asked === "flat" ? "flat" : "native";
        const draft = asked === "flat" ? flatTableMarkdown(table) : nativeTableMarkdown(table);
        const fn = await settleFootnotes([draft], { reserve: 6, defs });
        const settled = (text) => (fn ? fn.apply(text) : text);
        if (tryGrid) {
          try {
            const spec = { ...toGridSpec(table), parentUid: card, order: 0 };
            if (fn) spec.rows = spec.rows.map((row) => row.map(settled));
            if (rawSize.widths) spec.widths = rawSize.widths;
            const info = await host.createGridTable(spec);
            if (info?.uid) { uid = info.uid; path = "grid"; }
          } catch {
            uid = null;
          }
        }
        if (!uid) {
          const roots = await host.fromMarkdown({ parentUid: card, order: 0, markdown: settled(draft) });
          uid = roots[0] || null;
          path = asked === "flat" ? "flat" : "native";
        }
        if (!uid) {
          await host.deleteBlock(card);
          return { ok: false, reason: "empty" };
        }
        // The Source:: pin stays under the table block, so the caption keeps exactly one child.
        if (pin) await citePin(uid, pin);
        repull();
        return { ok: true, uid: card, tableUid: uid, path, w: size.w, h: size.h };
      });
    },

    // One card per section, stacked down from the drop point. Cap keeps one undo step.
    sendParsedToBoard({ x, y, sections, pin } = {}) {
      if (!board || destroyed || gone) return Promise.resolve(undefined);
      const list = Array.isArray(sections) ? sections.filter((section) => section && String(section.markdown ?? "").trim()) : [];
      if (!list.length) return Promise.resolve({ ok: true, uids: [], writes: 0 });
      const capped = capBulk(list, emit, PARSE_SECTION_CAP);
      const cardH = DEFAULT_SIZES.card.h;
      const cardW = DEFAULT_SIZES.card.w;
      return runParsed(async () => {
        const uids = [];
        let orderParent = null;
        let orderCursor = null;
        const fn = await settleFootnotes(capped.map((section) => section.markdown), { reserve: capped.length * 2 });
        for (let i = 0; i < capped.length; i += 1) {
          const nested = nestMarkdownUnderFirst(fn ? fn.apply(capped[i].markdown) : capped[i].markdown);
          if (bulletCount(nested) === 0) continue;
          const py = y + i * (cardH + SECTION_GAP);
          const size = clampSize("card", cardW, cardH);
          const { parent, rel } = placeParsed(x, py, size.w, size.h);
          const layout = withCardLook({ x: rel.x, y: rel.y, w: size.w, h: size.h }, nested);
          const plexus = serializeItemLayout(layout);
          let order;
          if (orderParent === parent && orderCursor != null) order = orderCursor;
          else {
            order = insertOrder(parent);
            orderParent = parent;
            orderCursor = order;
          }
          const roots = await host.fromMarkdown({ parentUid: parent, order, markdown: nested });
          const uid = roots[0];
          if (!uid) continue;
          await host.updateProps(uid, plexus);
          uids.push(uid);
          orderCursor = advanceOrder(order, roots.length);
          orderParent = parent;
        }
        if (pin && uids[0]) await citePin(uids[0], pin);
        repull();
        return { ok: true, uids };
      });
    },

    // Copy with source. The pin (and its container, when missing) is the whole undo step.
    ensurePdfPin(spec) {
      if (destroyed || gone) return Promise.resolve({ ok: false, reason: "gone" });
      return runParsed(async () => {
        const before = Number(host.stats?.writes) || 0;
        const made = await writePdfPin(spec);
        const writes = Math.max(0, (Number(host.stats?.writes) || 0) - before);
        return { ok: Boolean(made.uid), uid: made.uid || "", reused: Boolean(made.reused), writes };
      });
    },

    // Notes a kept read on the PDF block's props: one write, one undo step. Nothing else changes.
    noteRead(blockUid, entry) {
      if (destroyed || gone) return Promise.resolve({ ok: false, reason: "gone" });
      return runParsed(async () => {
        const reads = mergeReads(host.pullProps(blockUid)?.[READS_KEY], entry);
        await host.updateReads(blockUid, reads);
        return { ok: true, writes: 1 };
      });
    },

    createText({ x, y, string = "", look, w, h, color, shape } = {}) {
      return txn((t) => {
        const sticky = look === "sticky";
        const dw = sticky ? STICKY_SIZE.w : DEFAULT_SIZES.text.w;
        const dh = sticky ? STICKY_SIZE.h : DEFAULT_SIZES.text.h;
        const size = { w: typeof w === "number" ? w : dw, h: typeof h === "number" ? h : dh };
        const parent = containerAt(board, { x: x + size.w / 2, y: y + size.h / 2 }, { rects });
        const rel = toRelative(board, parent, { x, y }, rects);
        const layout = { type: "text", x: rel.x, y: rel.y };
        if (sticky || typeof w === "number") layout.w = size.w;
        if (sticky || typeof h === "number") layout.h = size.h;
        if (sticky) {
          layout.look = "sticky";
          layout.color = styleColor(color) || STICKY_COLOR;
        }
        if (SHAPES.includes(shape)) layout.shape = shape;
        const id = t.create({ parent, string, plexus: serializeItemLayout(layout) });
        applyFit(t, [id]);
        return id;
      });
    },

    createSection({ rect, title = "Section", color, look, axis } = {}) {
      return txn((t) => makeSection(t, rect, title, color, null, { look, axis }));
    },

    wrapInSection(uids) {
      return txn((t) => {
        const top = topLevelOf(board, uids);
        const b = boundsOf(top.map((id) => rects.get(id)));
        if (!b) return null;
        const pad = 32;
        const rect = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
        return makeSection(t, rect, "Section", undefined, top);
      });
    },

    // One undo. Creates a section titled `name`, or moves the pages into the one that already has that title.
    groupUnder(uids, title) {
      const name = String(title || "").trim();
      if (!name || !board || destroyed) return Promise.resolve(null);
      const pages = capBulk(topLevelOf(board, uids), emit).filter((id) => {
        const it = board.items.get(id);
        return it?.type !== "section" && it?.kind === "page" && namespaceParent(it.title) === name;
      });
      if (!pages.length) return Promise.resolve(null);
      const existing = [...board.items.values()].find((it) => it.type === "section" && it.title === name);
      const moving = pages.filter((id) => board.items.get(id).parentUid !== existing?.uid);
      if (!moving.length) return Promise.resolve(existing?.uid ?? null);
      return txn((t) => {
        if (existing) {
          const sec = rects.get(existing.uid);
          let y = 24;
          for (const member of existing.members) {
            const r = rects.get(member);
            if (!r || !sec) continue;
            y = Math.max(y, round1(r.y - sec.y + r.h + 16));
          }
          let x = 24;
          for (const id of moving) {
            const r = rects.get(id);
            t.move(id, existing.uid, "last");
            t.props(id, itemPlexus(id, { x, y }));
            x += round1((r?.w || DEFAULT_SIZES.card.w) + 16);
          }
          applyFit(t, [existing.uid]);
          return existing.uid;
        }
        const b = boundsOf(moving.map((id) => rects.get(id)));
        if (!b) return null;
        const pad = 32;
        const rect = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
        return makeSection(t, rect, name, undefined, moving);
      });
    },

    createBoard({ rect, title } = {}) {
      return txn((t) => {
        const d = DEFAULT_BOARD_CARD;
        const r = { x: rect?.x ?? 0, y: rect?.y ?? 0, w: rect?.w ?? d.w, h: rect?.h ?? d.h };
        const size = clampSize("card", r.w, r.h);
        const id = makeBoard(t, { x: r.x, y: r.y, w: size.w, h: size.h }, title, undefined);
        applyFit(t, [id]);
        return id;
      });
    },

    // The drawing block gets a string and no props. The ref card is the only plexus write.
    createDrawing({ x, y } = {}) {
      if (!board || destroyed || gone) return Promise.resolve(undefined);
      const spec = drawingCreateSpec(uid);
      const api = globalThis.RoamPlexus || globalThis.window?.RoamPlexus || null;
      const place = () => {
        if (api && typeof api.create === "function") {
          return Promise.resolve(api.create({ parentUid: spec.parentUid, order: spec.order }))
            .then((made) => {
              const id = made?.uid || null;
              // The drawing block is outside this host's write count. The open group still undoes it.
              if (id) host.adoptCreated?.(id);
              return id;
            });
        }
        if (typeof host.createBlock !== "function") return Promise.resolve(null);
        return Promise.resolve(host.createBlock(spec)).then((made) => (typeof made === "string" ? made : made?.uid || null));
      };
      const stamp = stampList();
      // The drawing block and its ref card are one undo step: one host group around both writes. The group is
      // taken outside the write queue (stampedRun and txn each take a queue slot, so holding it would deadlock).
      return grouped(() => {
        const placed = stamp.length
          ? stampedRun(stamp, place).catch((err) => { handleFailure(err); return null; })
          : place();
        return placed.then((drawingUid) => {
          const ref = drawingRefString(drawingUid);
          if (!ref || !board || destroyed || gone) return null;
          return txn((t) => {
            const size = { w: DEFAULT_SIZES.card.w, h: DEFAULT_SIZES.card.h };
            const px = Number.isFinite(x) ? x : 40;
            const py = Number.isFinite(y) ? y : 40;
            const parent = containerAt(board, { x: px + size.w / 2, y: py + size.h / 2 }, { rects });
            const rel = toRelative(board, parent, { x: px, y: py }, rects);
            const id = t.create({
              parent,
              string: ref,
              plexus: serializeItemLayout({ x: rel.x, y: rel.y, w: size.w, h: size.h }),
            });
            applyFit(t, [id]);
            return id;
          });
        });
      });
    },

    wrapInBoard(uids) {
      return txn((t) => {
        const top = topLevelOf(board, uids);
        const b = boundsOf(top.map((id) => rects.get(id)));
        if (!b) return null;
        const card = { x: b.x, y: b.y, w: Math.min(480, Math.max(240, b.w)), h: Math.min(360, Math.max(180, b.h)) };
        const boardUid = makeBoard(t, card, "", new Set(top), b);
        moveItemsInto(t, top, boardUid, { x: b.x, y: b.y }, { x: 0, y: 0 });
        applyFit(t, [boardUid]);
        return boardUid;
      });
    },

    moveIntoBoard(uids, boardUid) {
      if (!board || destroyed) return Promise.resolve(null);
      const target = board.items.get(boardUid);
      if (!target || target.kind !== "board" || !target.enhanced) return Promise.resolve(null);
      const top = topLevelOf(board, uids).filter((id) => id !== boardUid && !descendantsOf(board, id).has(boardUid));
      if (!top.length) return Promise.resolve(null);
      const preview = boardPreview(target);
      const cb = preview.bounds;
      const place = cb ? { x: cb.x + cb.w + 48, y: cb.y } : { x: 0, y: 0 };
      const origin = boundsOf(top.map((id) => rects.get(id)));
      const moved = new Set(top);
      for (const id of top) for (const d of descendantsOf(board, id)) moved.add(d);
      const undoItems = top.map((id) => {
        const hit = ix().get(id);
        return { uid: id, parentUid: hit.parent[UID], order: kidsOf(hit.parent).indexOf(hit.node), plexus: clone(readPlexus(hit.node[PROPS])) };
      }).sort((a, b) => a.order - b.order);
      const undoEdges = [];
      const info = { createdContainer: null };
      return txn((t) => {
        moveItemsInto(t, top, boardUid, origin, place, { moved, undoEdges, info });
        applyFit(t, [boardUid]);
        return {
          moved: top.slice(),
          title: target.title,
          boardUid,
          undo: () => txn((u) => {
            for (const it of undoItems) {
              u.move(it.uid, it.parentUid, it.order);
              u.props(it.uid, it.plexus);
            }
            for (const e of undoEdges.sort((a, b) => a.order - b.order)) {
              if (e.deleted) u.create({ uid: e.uid, parent: e.parent, order: e.order, string: e.string, plexus: e.plexus });
              else {
                if (e.relocated) u.move(e.uid, e.parent, e.order);
                u.props(e.uid, e.plexus);
                u.string(e.uid, e.string);
              }
            }
            if (info.createdContainer) u.del(info.createdContainer);
          }),
        };
      });
    },

    renameBoard(id, title) {
      return txn((t) => {
        const cur0 = board.items.get(id);
        if (cur0?.kind !== "board" || !cur0.enhanced) return;
        const cur = rawNode(id)?.[STR];
        if (cur === undefined) return;
        const next = setBoardTitle(cur, title);
        if (next !== cur) t.string(id, next);
      });
    },

    addRefCards(list) {
      const items = capBulk(list ?? [], emit);
      return txn((t) => {
        const ids = items.map(({ string, x, y, w, h }) => cardAt(t, string, x, y, w || h ? { w, h } : null));
        applyFit(t, ids);
        return ids;
      });
    },

    // The stored :plexus layout of a board block (the migration copies it to the new page card).
    layoutOf(id) {
      const p = readPlexus(rawNode(id)?.[PROPS]);
      return p && typeof p === "object" ? { ...p } : null;
    },

    // PDF cards that link the PDF's page. Each row: { title, x, y, pageUid?, newPage?: true, url? }.
    // A new page gets the `{{[[pdf]]: url}}` block first on it; an existing page only gets the card.
    addPdfPageCards(list) {
      const rows = capBulk(list ?? [], emit).filter((row) => row && typeof row.title === "string" && row.title);
      if (!rows.length) return Promise.resolve([]);
      return txn((t) => {
        const ids = [];
        for (const row of rows) {
          let pageUid = row.pageUid || null;
          if (row.newPage) pageUid = t.page({ uid: pageUid || undefined, title: row.title });
          if (row.url && pageUid) {
            const string = `{{[[pdf]]: ${row.url}}}`;
            const pdfUid = t.create({ parent: pageUid, order: 0, string });
            pendingPdfPages.set(row.title, { pageUid, title: row.title, pdfUid, string });
          }
          ids.push(cardAt(t, pageCardString(row.title), row.x, row.y, DEFAULT_SIZES.pdf));
        }
        applyFit(t, ids);
        return ids;
      });
    },

    // "Move PDFs to their own pages": apply a plan from planPdfMigration for THIS board. One undo group.
    // A pdf block that is no longer an old-style card on this board is skipped, so a second run writes nothing.
    movePdfsToPages(plan) {
      if (!plan || plan.boardUid !== uid) return Promise.resolve({ moved: 0, refused: "board" });
      let graphNow = "";
      try { graphNow = String(host.graphName?.() || ""); } catch { graphNow = ""; }
      if (plan.graph && graphNow && plan.graph !== graphNow) return Promise.resolve({ moved: 0, refused: "graph" });
      const moves = (plan.moves || []).filter((m) => isInlinePdfCard(board?.items?.get(m.pdfUid)) && m.cardUid && m.page?.title);
      if (!moves.length) return Promise.resolve({ moved: 0 });
      const moving = new Set(moves.map((m) => m.pdfUid));
      // Its own undo entry: the inverse is recorded here, from the state before the first write, and applied by
      // explicit writes. It does not depend on how many native Roam undo steps these writes made.
      const records = [];
      const edgeRecords = [];
      const custom = {
        forward: [],
        async undo() {
          const ops = [];
          for (const r of records) ops.push({ op: "delete", uid: r.newCardUid });
          const back = records.slice().sort((a, b) => (a.originalParentUid < b.originalParentUid ? -1 : a.originalParentUid > b.originalParentUid ? 1 : a.originalOrder - b.originalOrder));
          for (const r of back) {
            ops.push({ op: "move", uid: r.pdfUid, parent: r.originalParentUid, order: r.originalOrder });
            ops.push({ op: "props", uid: r.pdfUid, plexus: r.originalProps });
          }
          for (const e of edgeRecords) {
            ops.push({ op: "string", uid: e.uid, string: e.oldString });
            ops.push({ op: "props", uid: e.uid, plexus: e.oldProps });
          }
          await execute(ops);
          // Roam applies the move-back after execute resolves, so a created page can still hold its pdf block here.
          for (const r of records) {
            if (!r.pageCreated) continue;
            for (let tries = 0; tries < 15; tries += 1) {
              const page = host.pullPage?.(r.pageTitle);
              if (!page) break;
              if (!(page[":block/children"] || []).length) { await host.deletePage?.(r.pageUid); break; }
              await new Promise((resolve) => setTimeout(resolve, 200));
            }
          }
        },
        async redo() {
          const ops = custom.forward.filter((op) => op.op !== "page" || host.pageExists?.(op.title) !== true);
          await execute(ops);
        },
      };
      return txn((t) => {
        for (const m of moves) {
          const parent = rawNode(m.parentUid) ? m.parentUid : board.items.get(m.pdfUid).parentUid;
          const kids = kidsOf(rawNode(parent));
          const at = Math.max(0, kids.findIndex((k) => k[UID] === m.pdfUid));
          const pdfString = rawNode(m.pdfUid)?.[STR] || `{{[[pdf]]: ${m.url}}}`;
          const originalProps = clone(rawPlexus(m.pdfUid));
          const pageUid = m.page.uid || t.page({ uid: m.page.newUid || undefined, title: m.page.title });
          records.push({ pdfUid: m.pdfUid, originalParentUid: parent, originalOrder: at, originalProps, newCardUid: m.cardUid, pageUid, pageTitle: m.page.title, pageCreated: !m.page.uid });
          t.props(m.pdfUid, null);
          t.move(m.pdfUid, pageUid, 0);
          t.create({ parent, uid: m.cardUid, string: m.cardString, plexus: m.layout, order: at });
          pendingPdfPages.set(m.page.title, { pageUid, title: m.page.title, pdfUid: m.pdfUid, string: pdfString });
        }
        let edges = 0;
        for (const e of plan.edges || []) {
          const cur = board.edges?.get(e.uid);
          if (!cur || !(moving.has(cur.from) || moving.has(cur.to))) continue;
          edgeRecords.push({ uid: e.uid, oldString: rawNode(e.uid)?.[STR] ?? "", oldProps: clone(rawPlexus(e.uid)) });
          t.string(e.uid, e.string);
          t.props(e.uid, edgePlexus(e.uid, { from: e.from, to: e.to }));
          edges += 1;
        }
        return { moved: moves.length, edges };
      }, custom);
    },

    // "Fold tables under captions": apply a plan from planTableCaptions for THIS board. One undo entry with recorded
    // inverse writes. A table that is no longer an old-form card of this board is skipped, so a second run writes nothing.
    foldTableCaptions(plan) {
      if (!plan || plan.boardUid !== uid) return Promise.resolve({ folded: 0, refused: "board" });
      let graphNow = "";
      try { graphNow = String(host.graphName?.() || ""); } catch { graphNow = ""; }
      if (plan.graph && graphNow && plan.graph !== graphNow) return Promise.resolve({ folded: 0, refused: "graph" });
      const folds = (plan.folds || []).filter((f) => isOldTableCard(board?.items?.get(f.tableUid)) && f.captionUid);
      if (!folds.length) return Promise.resolve({ folded: 0 });
      const folding = new Set(folds.map((f) => f.tableUid));
      const records = [];
      const edgeRecords = [];
      const custom = {
        forward: [],
        async undo() {
          // Highest original order first: every slot before it still holds one block (a caption stands where its
          // table was), so each table lands right before its own caption. Captions go only after their table left.
          const back = records.slice().sort((a, b) => (a.parentUid < b.parentUid ? -1 : a.parentUid > b.parentUid ? 1 : b.order - a.order));
          const ops = [];
          for (const r of back) {
            ops.push({ op: "move", uid: r.tableUid, parent: r.parentUid, order: r.order });
            ops.push({ op: "props", uid: r.tableUid, plexus: r.props });
          }
          for (const e of edgeRecords) {
            ops.push({ op: "string", uid: e.uid, string: e.oldString });
            ops.push({ op: "props", uid: e.uid, plexus: e.oldProps });
          }
          await execute(ops);
          for (const r of back) {
            // Deleting a caption that still holds its table would delete the table: wait until a read proves the
            // table left it (its location under another parent, or the caption's children without it). A failed
            // read is "not moved yet"; if no read ever proves it, the caption stays.
            let out = false;
            for (let tries = 0; tries < 15 && !out; tries += 1) {
              let loc = null;
              try { loc = host.blockLocation?.(r.tableUid) || null; } catch { loc = null; }
              if (loc) out = loc.parentUid !== r.captionUid;
              else {
                let kids;
                try { kids = host.outlineKids?.([r.captionUid])?.get(r.captionUid); } catch { kids = undefined; }
                out = Array.isArray(kids) && !kids.some((k) => k.uid === r.tableUid);
              }
              if (!out) await new Promise((resolve) => setTimeout(resolve, 200));
            }
            if (out) await execute([{ op: "delete", uid: r.captionUid }]);
          }
        },
        async redo() {
          await execute(custom.forward);
        },
      };
      return txn((t) => {
        for (const f of folds) {
          const parent = board.items.get(f.tableUid).parentUid;
          const kids = kidsOf(rawNode(parent));
          const at = Math.max(0, kids.findIndex((k) => k[UID] === f.tableUid));
          const props = clone(rawPlexus(f.tableUid));
          records.push({ tableUid: f.tableUid, captionUid: f.captionUid, parentUid: parent, order: at, props });
          t.create({ parent, uid: f.captionUid, string: f.caption, plexus: f.layout, open: false, order: at });
          t.props(f.tableUid, null);
          t.move(f.tableUid, f.captionUid, 0);
        }
        let edges = 0;
        for (const e of plan.edges || []) {
          const cur = board.edges?.get(e.uid);
          if (!cur || ![cur.from, cur.to, cur.fromBlock, cur.toBlock].some((id) => id && folding.has(id))) continue;
          edgeRecords.push({ uid: e.uid, oldString: rawNode(e.uid)?.[STR] ?? "", oldProps: clone(rawPlexus(e.uid)) });
          const patch = { from: e.from, to: e.to };
          if (e.fromBlock) patch.fromBlock = e.fromBlock;
          if (e.toBlock) patch.toBlock = e.toBlock;
          t.string(e.uid, e.string);
          t.props(e.uid, edgePlexus(e.uid, patch));
          edges += 1;
        }
        return { folded: folds.length, edges };
      }, custom);
    },

    // "Fold queries on this page": the plan for the page that holds this board (queries outside every board).
    queryFoldPlan({ limit } = {}) {
      let pageUid = "";
      try { pageUid = String(host.blockPageUid?.(uid) || ""); } catch { pageUid = ""; }
      let graph = "";
      try { graph = String(host.graphName?.() || ""); } catch { graph = ""; }
      return planQueryFolds({
        pageUid,
        boardUid: uid,
        graph,
        limit,
        kidsOfMany: (ids) => (typeof host.outlineKids === "function" ? host.outlineKids(ids) : new Map()),
        newUid: () => host.generateUid?.() || "",
      });
    },

    // Applies a queryFoldPlan: each query that is still where the plan saw it gets a folded caption in its place and
    // moves under it. The blocks are outside the board, so this writes straight through the queue (no board model
    // change). One custom undo entry with recorded inverse writes; a second run plans nothing.
    foldPageQueries(plan) {
      if (!plan || plan.boardUid !== uid || destroyed || gone) return Promise.resolve({ folded: 0, refused: "board" });
      let graphNow = "";
      try { graphNow = String(host.graphName?.() || ""); } catch { graphNow = ""; }
      if (plan.graph && graphNow && plan.graph !== graphNow) return Promise.resolve({ folded: 0, refused: "graph" });
      const folds = [];
      for (const f of plan.folds || []) {
        if (!f?.queryUid || !f.captionUid) continue;
        let loc = null;
        try { loc = host.blockLocation?.(f.queryUid) || null; } catch { loc = null; }
        if (!loc || loc.parentUid !== f.parentUid) continue;
        const now = host.pullEntity?.("[:block/string]", f.queryUid)?.[":block/string"];
        if (!hasQueryMacro(now)) continue;
        folds.push({ ...f, order: loc.order });
      }
      if (!folds.length) return Promise.resolve({ folded: 0 });
      const list = [];
      for (const f of folds) {
        list.push({ op: "create", uid: f.captionUid, parent: f.parentUid, order: f.order, string: f.caption, open: false });
        list.push({ op: "move", uid: f.queryUid, parent: f.captionUid, order: 0 });
      }
      if (!bulkAllowed(list.length)) return Promise.resolve({ folded: 0, refused: "bulk" });
      const custom = {
        forward: list,
        async undo() {
          // Highest original order first, per parent: each query lands right before its own caption.
          const back = folds.slice().sort((a, b) => (a.parentUid < b.parentUid ? -1 : a.parentUid > b.parentUid ? 1 : b.order - a.order));
          await execute(back.map((f) => ({ op: "move", uid: f.queryUid, parent: f.parentUid, order: f.order })));
          for (const f of back) {
            // Deleting a caption that still holds its query would delete the query: wait until a read proves the
            // query left it (its location under another parent, or the caption's children without it). A failed
            // read is "not moved yet"; if no read ever proves it, the caption stays.
            let out = false;
            for (let tries = 0; tries < 15 && !out; tries += 1) {
              let loc = null;
              try { loc = host.blockLocation?.(f.queryUid) || null; } catch { loc = null; }
              if (loc) out = loc.parentUid !== f.captionUid;
              else {
                let kids;
                try { kids = host.outlineKids?.([f.captionUid])?.get(f.captionUid); } catch { kids = undefined; }
                out = Array.isArray(kids) && !kids.some((k) => k.uid === f.queryUid);
              }
              if (!out) await new Promise((resolve) => setTimeout(resolve, 200));
            }
            if (out) await execute([{ op: "delete", uid: f.captionUid }]);
          }
        },
        async redo() {
          await execute(custom.forward);
        },
      };
      return queue.run(() => grouped(async () => {
        host.setCustomUndo?.(custom);
        try {
          await execute(list, { hold: true });
        } catch (err) {
          host.setCustomUndo?.(null);
          throw err;
        }
      })).then(() => ({ folded: folds.length }), (err) => {
        console.error("[plexus session] fold queries failed", err);
        setSyncState("failed");
        emit("toast", { message: "Couldn't fold every query. Check the page in Roam." });
        return { folded: 0, failed: true };
      });
    },

    // One ref card, centered on the board's content (the origin when nothing is placed yet).
    addBlockRef(blockUid) {
      if (!blockUid || !board) return Promise.resolve(null);
      const at = cardAtCenter(boundsOf([...rects.values()]), DEFAULT_SIZES.card);
      return this.addRefCards([{ string: `((${blockUid}))`, x: at.x, y: at.y }]).then((ids) => ids?.[0] ?? null);
    },

    deleteItems(uids, { withContents = false, force = false } = {}) {
      return txn((t) => {
        const protectedItem = (id) => board.items.get(id).pinned
          || (withContents && [...descendantsOf(board, id)].some((d) => board.items.get(d).pinned));
        const set = new Set([...uids].filter((id) => board.items.has(id) && (force || !protectedItem(id))));
        if (!set.size) return;
        let edgeSet;
        if (withContents) {
          edgeSet = edgesTouching(board, set);
        } else {
          edgeSet = new Set();
          for (const e of board.edges.values()) if (set.has(e.from) || set.has(e.to)) edgeSet.add(e.uid);
          for (const id of set) {
            const item = board.items.get(id);
            if (item.type !== "section") continue;
            let survivor = item.parentUid;
            while (survivor !== uid && set.has(survivor)) survivor = board.items.get(survivor).parentUid;
            for (const m of item.members) {
              if (set.has(m)) continue;
              const r = rects.get(m);
              const rel = toRelative(board, survivor, { x: r.x, y: r.y }, rects);
              t.move(m, survivor, "last");
              t.props(m, itemPlexus(m, { x: rel.x, y: rel.y }));
            }
          }
        }
        for (const id of edgeSet) t.del(id);
        const explicit = withContents ? topLevelOf(board, set) : [...set].filter((id) => !set.has(board.items.get(id).parentUid));
        for (const id of explicit) t.del(id);
      });
    },

    setColor(uids, color) {
      return txn((t) => {
        for (const id of uids) {
          if (board.items.has(id)) t.props(id, itemPlexus(id, { color: color ?? undefined }));
          else if (board.edges.has(id)) t.props(id, edgePlexus(id, { color: color ?? undefined }));
        }
      });
    },

    setCollapsed(id, value) {
      return txn((t) => {
        if (board.items.has(id)) t.props(id, itemPlexus(id, { collapsed: value ? true : undefined }));
      });
    },

    // "Fold sections in the outline" / "Unfold sections": Roam's :block/open on SECTION blocks only. A page or board
    // card folded in Roam blanks its body (cards.js), and a card's own children are its contents. Gated on the
    // collapse-outline setting. `fold` false lists the folded sections for unfolding.
    sectionFoldPlan(fold = true) {
      const plan = { boardUid: uid, fold: fold !== false, uids: [] };
      if (!board || destroyed || gone) return plan;
      if (!collapseOutline()) return { ...plan, refused: "setting" };
      for (const item of board.items.values()) {
        if (item.type !== "section") continue;
        const node = rawNode(item.uid);
        if (!node) continue;
        const isOpen = node[OPEN] !== false;
        if (plan.fold === isOpen) plan.uids.push(item.uid);
      }
      return plan;
    },

    // Applies a sectionFoldPlan. Sections that no longer need the change are skipped. One custom undo entry; the
    // writes go through commit(), so a long list pauses between batches while Roam's sync dot says saving.
    async foldSections(plan) {
      const none = { changed: 0 };
      if (!plan || plan.boardUid !== uid || !board || destroyed || gone) return { ...none, refused: "board" };
      if (!collapseOutline()) return { ...none, refused: "setting" };
      const open = plan.fold === false;
      const ops = [];
      const back = [];
      for (const id of plan.uids || []) {
        const item = board.items.get(id);
        const node = rawNode(id);
        if (item?.type !== "section" || !node) continue;
        if ((node[OPEN] !== false) === open) continue;
        ops.push({ op: "open", uid: id, open });
        back.push({ op: "open", uid: id, open: !open });
        node[OPEN] = open;
      }
      if (!ops.length) return none;
      const custom = {
        forward: ops,
        async undo() { await execute(back); },
        async redo() { await execute(custom.forward); },
      };
      await commit(ops, undefined, custom);
      return { changed: ops.length };
    },

    // Roam :block/open on the card block only. Fold stays on plexus collapsed.
    setBlockOpen(id, open) {
      const item = board?.items.get(id);
      if (!item || item.type !== "card") return Promise.resolve(false);
      const node = rawNode(id);
      if (!node) return Promise.resolve(false);
      const next = open !== false;
      if ((node[OPEN] !== false) === next) return Promise.resolve(false);
      node[OPEN] = next;
      const stamp = stampList();
      publish();
      const write = async () => {
        await host.setOpen(id, next);
        return true;
      };
      return (stamp.length ? stampedRun(stamp, write) : queue.run(write)).catch((err) => { handleFailure(err); return false; });
    },

    // CH-1: show or hide a card's children inside it. One props write. Unfold grows from the stored
    // folded height; refold returns to it. A resize while open is remembered as the unfolded size only.
    setKids(id, value, extraH = 0) {
      return txn((t) => {
        const item = board.items.get(id);
        if (!item || item.type !== "card" || (item.kind !== "note" && item.kind !== "block")) return;
        const on = value === true;
        if (Boolean(item.kids) === on) return;
        const plan = kidsHeightPlan({ on, h: item.h, extraH, memory: kidsMemory.get(id) });
        kidsMemory.set(id, plan.memory);
        const patch = { kids: on ? true : undefined };
        if (plan.h !== item.h) patch.h = plan.h;
        t.props(id, itemPlexus(id, patch));
        if (on && plan.h > item.h) applyFit(t, [id]);
      });
    },

    // Shift+Enter on the card's top block. One custom undo removes the child and restores the folded size.
    addCardChild(id) {
      const item = board?.items.get(id);
      if (!item || item.type !== "card" || (item.kind !== "note" && item.kind !== "block")) return Promise.resolve(null);
      const beforePlexus = clone(rawPlexus(id));
      const beforeMem = kidsMemory.has(id) ? { ...kidsMemory.get(id) } : null;
      const beforeOpen = rawNode(id)?.[OPEN] !== false;
      let childUid = null;
      let afterMem = beforeMem;
      const custom = {
        async undo() {
          const back = [];
          if (childUid) back.push({ op: "delete", uid: childUid });
          back.push({ op: "props", uid: id, plexus: beforePlexus });
          if (!beforeOpen) back.push({ op: "open", uid: id, open: false });
          if (beforeMem) kidsMemory.set(id, { ...beforeMem });
          else kidsMemory.delete(id);
          await execute(back);
        },
        async redo() {
          await execute(custom.forward);
          if (afterMem) kidsMemory.set(id, { ...afterMem });
          else kidsMemory.delete(id);
        },
      };
      return txn((t) => {
        childUid = t.create({ parent: id, string: "" });
        if (!item.kids) {
          const plan = kidsHeightPlan({ on: true, h: item.h, extraH: CHILD_GROW_H, memory: kidsMemory.get(id) });
          afterMem = plan.memory;
          kidsMemory.set(id, plan.memory);
          t.props(id, itemPlexus(id, { kids: true, h: plan.h }));
          if (plan.h > item.h) applyFit(t, [id]);
        }
        if (!beforeOpen) t.open(id, true);
        return childUid;
      }, custom);
    },

    // :block/open on a block inside a card. One custom undo. The card renderer also toggles the row locally,
    // because a child fold does not mark the card dirty.
    setNodeOpen(id, open) {
      if (!board || destroyed || gone) return Promise.resolve(false);
      const node = rawNode(id);
      if (!node || node === raw) return Promise.resolve(false);
      const next = open !== false;
      const prev = node[OPEN] !== false;
      if (prev === next) return Promise.resolve(false);
      node[OPEN] = next;
      const custom = {
        async undo() {
          const n = rawNode(id);
          if (n) n[OPEN] = prev;
          await execute([{ op: "open", uid: id, open: prev }]);
        },
        async redo() {
          const n = rawNode(id);
          if (n) n[OPEN] = next;
          await execute([{ op: "open", uid: id, open: next }]);
        },
      };
      return commit([{ op: "open", uid: id, open: next }], true, custom);
    },

    setFontSize(id, size) {
      return txn((t) => {
        if (board.items.has(id)) t.props(id, itemPlexus(id, { fontSize: size }));
      });
    },

    // One undo step. Cards and text only. null clears a key. Invalid values are dropped by serialize.
    setItemStyle(uids, patch = {}) {
      return txn((t) => {
        const ids = capBulk([...new Set(uids ?? [])].filter((id) => {
          const item = board.items.get(id);
          return item && item.type !== "section";
        }), emit);
        let n = 0;
        for (const id of ids) {
          const nextPatch = {};
          for (const k of ITEM_STYLE_KEYS) {
            if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
            nextPatch[k] = patch[k] == null ? undefined : patch[k];
          }
          const next = itemPlexus(id, nextPatch);
          if (stable(next) !== stable(rawPlexus(id))) { t.props(id, next); n++; }
        }
        return n;
      });
    },

    resetItemStyle(uids) {
      const patch = {};
      for (const k of ITEM_STYLE_KEYS) patch[k] = null;
      return this.setItemStyle(uids, patch);
    },

    setSectionStyle(uids, patch = {}) {
      return txn((t) => {
        const ids = capBulk([...new Set(uids ?? [])].filter((id) => board.items.get(id)?.type === "section"), emit);
        let n = 0;
        for (const id of ids) {
          const nextPatch = {};
          for (const k of SECTION_STYLE_KEYS) {
            if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
            nextPatch[k] = patch[k] == null ? undefined : patch[k];
          }
          const next = itemPlexus(id, nextPatch);
          if (stable(next) !== stable(rawPlexus(id))) { t.props(id, next); n++; }
        }
        return n;
      });
    },

    resetSectionStyle(uids) {
      const patch = {};
      for (const k of SECTION_STYLE_KEYS) patch[k] = null;
      return this.setSectionStyle(uids, patch);
    },

    // Board-level section defaults on plexus.defaults.section. null removes a key.
    setSectionDefaults(patch = {}) {
      return txn((t) => {
        if (!board.enhanced) return false;
        const base = rawPlexus(uid);
        const prevDefaults = base.defaults && typeof base.defaults === "object" && !Array.isArray(base.defaults) ? base.defaults : {};
        const section = prevDefaults.section && typeof prevDefaults.section === "object" ? { ...prevDefaults.section } : {};
        for (const k of SECTION_STYLE_KEYS) {
          if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
          if (patch[k] == null) delete section[k];
          else section[k] = patch[k];
        }
        const clean = normalizeSectionDefaults(section);
        const next = { ...base, defaults: { ...prevDefaults } };
        if (Object.keys(clean).length) next.defaults.section = clean;
        else {
          delete next.defaults.section;
          if (!Object.keys(next.defaults).length) delete next.defaults;
        }
        if (stable(next) !== stable(base)) t.props(uid, next);
        return true;
      });
    },

    resetSectionDefaults() {
      const patch = {};
      for (const k of SECTION_STYLE_KEYS) patch[k] = null;
      return this.setSectionDefaults(patch);
    },

    setLook(id, look) {
      return txn((t) => {
        const item = board.items.get(id);
        if (!item || item.type !== "card") return;
        if (look !== "block" && look !== "card") return;
        t.props(id, itemPlexus(id, { look }));
      });
    },

    setString(id, string) {
      return txn((t) => {
        const cur = rawNode(id)?.[STR];
        if (cur === undefined || cur === string) return;
        t.string(id, string);
      });
    },

    // The highlight block is not on the board. setString returns when rawNode misses, so this reads blockString and writes one string op.
    // PDFH-5. Roam's own note button makes one empty child under the highlight; this is the same write,
    // one undo step. The highlight block is on the PDF's page, not on this board, so it is a host write.
    addHighlightNote(highlightUid) {
      if (typeof highlightUid !== "string" || !highlightUid || destroyed) return Promise.resolve(null);
      return queue.run(() => grouped(() => host.createBlock({ parentUid: highlightUid, order: "last", string: "" })))
        .then((id) => (typeof id === "string" ? id : null), (err) => { handleFailure(err); return null; });
    },

    setHighlightColor(blockUid, name) {
      return txn((t) => {
        if (!HIGHLIGHT_COLORS.includes(name)) return;
        const cur = host.blockString?.(blockUid);
        if (cur == null) return;
        const next = rewriteHighlightTag(cur, name);
        if (next === cur) return;
        t.string(blockUid, next);
      });
    },

    growToFit(id, contentHeight) {
      return txn((t) => {
        const item = board.items.get(id);
        if (!item || item.type === "section") return;
        const target = Math.min(900, Math.ceil(contentHeight));
        if (!(target > item.h)) return;
        t.props(id, itemPlexus(id, { h: target }));
        applyFit(t, [id]);
      });
    },

    fitSection(id, { shrink = true } = {}) {
      return txn((t) => {
        const item = board.items.get(id);
        if (!item || item.type !== "section" || !item.members.length) return false;
        const own = rects.get(id);
        const bounds = boundsOf(item.members.map((m) => rects.get(m)));
        let next = inflate(bounds, FIT_PAD);
        if (!shrink) next = unionRect(own, next);
        const size = clampSize("section", next.w, next.h);
        next = { x: round1(next.x), y: round1(next.y), w: round1(size.w), h: round1(size.h) };
        const origin = item.parentUid === uid ? { x: 0, y: 0 } : rects.get(item.parentUid) ?? { x: 0, y: 0 };
        const write = (target, patch) => {
          const plexus = itemPlexus(target, patch);
          if (stable(plexus) !== stable(rawPlexus(target))) t.props(target, plexus);
        };
        write(id, { x: round1(next.x - origin.x), y: round1(next.y - origin.y), w: next.w, h: next.h });
        for (const m of item.members) {
          const mr = rects.get(m);
          write(m, { x: round1(mr.x - next.x), y: round1(mr.y - next.y) });
        }
        applyFit(t, [id]);
        return true;
      });
    },

    setFit(id, on) {
      return txn((t) => {
        const item = board.items.get(id);
        if (!item || item.type !== "section") return;
        const want = on === false ? false : undefined;
        if ((item.autofit === false) === (want === false)) return;
        t.props(id, itemPlexus(id, { fit: want }));
      });
    },

    // EK-2: minimize a sticky to its header. One write, one undo step; the stored size stays.
    setMinimized(id, on) {
      return txn((t) => {
        const item = board.items.get(id);
        if (!item || item.type !== "text" || item.look !== "sticky" || Boolean(item.min) === Boolean(on)) return;
        t.props(id, itemPlexus(id, { min: on ? true : undefined }));
      });
    },

    setPinned(uids, on) {
      return txn((t) => {
        for (const id of new Set(uids ?? [])) {
          const item = board.items.get(id);
          if (!item || item.pinned === Boolean(on)) continue;
          t.props(id, itemPlexus(id, { pinned: on ? true : undefined }));
        }
      });
    },

    // One undo step. Pins or unpins the section and everything inside it. Does not write x/y/w/h.
    lockSection(id, on = true) {
      const item = board?.items.get(id);
      if (!item || item.type !== "section") return Promise.resolve(false);
      return this.setPinned([id, ...descendantsOf(board, id)], Boolean(on));
    },

    // Adds the description line, or deletes it. The block is a text child with look section-note.
    // No auto-fit: the section's stored size stays put.
    toggleSectionNote(id, string = "Description") {
      return txn((t) => {
        const item = board.items.get(id);
        if (!item || item.type !== "section") return null;
        const existing = item.members.find((m) => {
          const kid = board.items.get(m);
          return kid?.type === "text" && kid.look === "section-note";
        });
        if (existing) {
          t.del(existing);
          return null;
        }
        const w = Math.max(80, Math.min(360, item.w - 32));
        return t.create({
          parent: id,
          string,
          plexus: serializeItemLayout({ type: "text", look: "section-note", x: 16, y: 12, w, h: 32 }),
        });
      });
    },

    // bg / bgColor / bgImage / lodZoom: undefined leaves the key, null removes it.
    // bg is a pattern. bgColor is a tone name or #rrggbb. bgImage is an https URL, painted locked.
    // lodZoom is this board's map threshold (0.05–1.5). dock is this board's tool dock side.
    setBoardBackground({ bg, bgColor, bgImage, lodZoom, dock } = {}) {
      return txn((t) => {
        if (!board.enhanced) return false;
        let tone = bgColor;
        if (bg != null && !BOARD_PATTERNS.includes(bg)) return false;
        if (tone != null) {
          tone = boardColor(tone);
          if (!tone) return false;
        }
        let image = bgImage;
        if (image != null) {
          image = backgroundImage(image);
          if (!image) return false;
        }
        let zoom = lodZoom;
        if (zoom != null) {
          const picked = zoomThreshold(zoom, null);
          if (picked === 0.45 && Number(zoom) !== 0.45) return false;
          zoom = picked;
        }
        if (dock != null && !DOCK_POSITIONS.includes(dock)) return false;
        const base = rawPlexus(uid);
        const next = { ...base };
        for (const [key, value] of [["bg", bg], ["bgColor", tone], ["bgImage", image], ["lodZoom", zoom], ["dock", dock]]) {
          if (value === undefined) continue;
          if (value === null) delete next[key];
          else next[key] = value;
        }
        if (stable(next) !== stable(base)) t.props(uid, next);
        return true;
      });
    },

    setSectionLook(id, look) {
      return txn((t) => {
        const item = board.items.get(id);
        if (!item || item.type !== "section") return false;
        if (look != null && look !== "lane" && look !== "calendar" && look !== "timer") return false;
        t.props(id, itemPlexus(id, { look: look ?? null }));
        return true;
      });
    },

    applyCardTemplate(id, blocks) {
      return txn((t) => {
        const item = board.items.get(id);
        if (!item || item.type !== "card") return 0;
        const plan = cardTemplatePlan(blocks).slice(0, 45);
        for (const child of plan) t.create({ parent: id, order: "last", string: child.string });
        return plan.length;
      });
    },

    layoutByDate(id, opts) {
      return txn((t) => {
        const item = board.items.get(id);
        if (!item || item.type !== "section") return 0;
        const spec = opts && typeof opts === "object" ? opts : {};
        const mode = (typeof opts === "string" ? opts : spec.mode) || "attribute";
        const rows = Array.isArray(spec.rows) ? spec.rows : [];
        const cards = item.members.map((member) => board.items.get(member)).filter(Boolean);
        // The attribute source keeps 2.x placement exactly (UTC days). First/last mention come from the timeline.
        if (mode === "attribute") {
          const plan = capBulk(calendarLayout(cards), emit);
          for (const spot of plan) t.props(spot.uid, itemPlexus(spot.uid, { x: spot.x, y: spot.y }));
          return plan.length;
        }
        const spots = [];
        for (const card of cards) {
          const stamp = dateSource(card, rows, mode);
          if (stamp == null || !Number.isFinite(stamp)) continue;
          const day = new Date(stamp).getDate();
          if (!Number.isFinite(day) || day < 1) continue;
          spots.push({ uid: card.uid, x: 16 + (day - 1) * 28, y: 48, t: stamp });
        }
        spots.sort((a, b) => a.t - b.t || String(a.uid).localeCompare(String(b.uid)));
        const plan = capBulk(spots, emit);
        for (const spot of plan) t.props(spot.uid, itemPlexus(spot.uid, { x: spot.x, y: spot.y }));
        return plan.length;
      });
    },

    setCollapsedMany(uids, value) {
      return txn((t) => {
        let count = 0;
        for (const id of new Set(uids ?? [])) {
          const item = board.items.get(id);
          if (!item || item.type !== "card" || item.collapsed === Boolean(value)) continue;
          t.props(id, itemPlexus(id, { collapsed: value ? true : undefined }));
          count++;
        }
        return count;
      });
    },

    collapseAll(value, { within = null, except = [] } = {}) {
      return txn((t) => {
        const skipIds = new Set(except ?? []);
        const pool = within ? [...descendantsOf(board, within)] : [...board.items.keys()];
        let count = 0;
        for (const id of pool) {
          const item = board.items.get(id);
          if (!item || item.type !== "card" || skipIds.has(id) || item.collapsed === Boolean(value)) continue;
          t.props(id, itemPlexus(id, { collapsed: value ? true : undefined }));
          count++;
        }
        return count;
      });
    },

    // Reorder each parent's blocks so the outline matches the board. Positions stay. Moves go through the
    // host group, which splits a long run into chunks of 45 so one undo step stays inside Roam's depth.
    sortOutline() {
      return txn((t) => {
        let moves = 0;
        for (const group of readingOrder(board, rects)) {
          group.uids.forEach((id, index) => {
            const kids = kidsOf(rawNode(group.parent));
            const at = kids.findIndex((k) => k[UID] === id);
            if (at < 0 || at === index) return;
            t.move(id, group.parent, index);
            moves += 1;
          });
        }
        return moves;
      });
    },

    // Modes: row, column, grid, outline. A lone selected section tidies its members; otherwise each parent's
    // selected items are tidied among themselves. Writes only x and y. Resolves the number of items moved.
    tidyItems(uids, mode = "grid", { gap } = {}) {
      return txn((t) => {
        const top = topLevelOf(board, uids ?? []);
        const groups = new Map();
        if (top.length === 1 && board.items.get(top[0]).type === "section") {
          groups.set(top[0], board.items.get(top[0]).members.filter((m) => !board.items.get(m).pinned));
        } else {
          for (const id of top) {
            const it = board.items.get(id);
            if (it.pinned) continue;
            if (!groups.has(it.parentUid)) groups.set(it.parentUid, []);
            groups.get(it.parentUid).push(id);
          }
        }
        const opts = gap !== undefined ? { gap } : {};
        if (mode === "outline") opts.order = outlineOrder(board);
        const moved = [];
        for (const ids of groups.values()) {
          if (ids.length < 2) continue;
          const list = ids.map((id) => {
            const it = board.items.get(id);
            return { uid: id, x: it.x, y: it.y, w: it.w, h: it.h };
          });
          for (const p of tidyRects(list, mode, opts)) {
            const it = board.items.get(p.uid);
            if (Math.abs(p.x - it.x) < 0.05 && Math.abs(p.y - it.y) < 0.05) continue;
            t.props(p.uid, itemPlexus(p.uid, { x: round1(p.x), y: round1(p.y) }));
            moved.push(p.uid);
          }
        }
        applyFit(t, moved);
        return moved.length;
      });
    },

    sameSize(uids, primaryUid, mode = "both") {
      return txn((t) => {
        const ids = [...new Set([...(uids ?? []), primaryUid])].filter((id) => board.items.has(id));
        const list = ids.map((id) => ({ uid: id, w: board.items.get(id).w, h: board.items.get(id).h }));
        const changed = [];
        for (const c of sameSizeRects(list, primaryUid, mode)) {
          const item = board.items.get(c.uid);
          if (item.pinned) continue;
          const size = sectionFloor(c.uid, clampSize(item.type, c.w, c.h));
          if (round1(size.w) === item.w && round1(size.h) === item.h) continue;
          t.props(c.uid, itemPlexus(c.uid, { w: round1(size.w), h: round1(size.h) }));
          changed.push(c.uid);
        }
        applyFit(t, changed);
        return changed.length;
      });
    },

    resetSize(uids) {
      return txn((t) => {
        const changed = [];
        for (const id of new Set(uids ?? [])) {
          const item = board.items.get(id);
          if (!item || item.pinned) continue;
          const d = sectionFloor(id, defaultSizeFor(item));
          const w = round1(d.w);
          const h = round1(d.h);
          if (item.w === w && item.h === h) continue;
          t.props(id, itemPlexus(id, { w, h }));
          changed.push(id);
        }
        applyFit(t, changed);
        return changed.length;
      });
    },

    // Sets the height from measured content, shrinking as well as growing (growToFit only grows).
    fitToContent(id, contentHeight) {
      return txn((t) => {
        const item = board.items.get(id);
        if (!item || item.type === "section" || !Number.isFinite(contentHeight)) return;
        const target = Math.min(900, Math.max(MIN_SIZES[item.type]?.h ?? 1, Math.ceil(contentHeight)));
        if (target === item.h) return;
        t.props(id, itemPlexus(id, { h: target }));
        applyFit(t, [id]);
      });
    },

    addDailyCards(dates, { x = 0, y = 0 } = {}) {
      return txn((t) => {
        const have = new Set();
        for (const item of board.items.values()) if (item.kind === "page") have.add(item.target.title);
        const made = [];
        // Cards land in a row from the click point, skipping any spot an existing (or just placed) card occupies.
        const size = defaultSizeFor({ type: "card", kind: "page" });
        const occupied = [...board.items.values()].filter((it) => it.type !== "section").map((it) => rects.get(it.uid)).filter(Boolean);
        let slotX = x;
        const freeSlot = () => {
          const at = () => ({ x: slotX, y, w: size.w, h: size.h });
          while (occupied.some((r) => rectsIntersect(r, at()))) slotX += size.w + DAILY_GAP;
          const spot = at();
          occupied.push(spot);
          slotX += size.w + DAILY_GAP;
          return spot.x;
        };
        for (const d of dates ?? []) {
          const date = typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)
            ? new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)))
            : d;
          const title = dailyPageTitle(date);
          if (have.has(title)) continue;
          have.add(title);
          made.push(cardAt(t, `[[${title}]]`, freeSlot(), y));
        }
        applyFit(t, made);
        return made;
      });
    },

    addEdge({ from, to, fromSide, toSide, label = "", dir = "one", fromBlock, toBlock } = {}) {
      return txn((t) => {
        if (!from || !to || from === to) return null;
        const fromItem = board.items.has(from);
        const toItem = board.items.has(to);
        const fromEdge = !fromItem ? board.edges.get(from) : null;
        const toEdge = !toItem ? board.edges.get(to) : null;
        // One end may be an edge whose own target is a card. Both ends as edges is a second level.
        if (fromEdge && toEdge) return null;
        if (!fromItem && !(fromEdge && edgeMayTarget(fromEdge, board.edges))) return null;
        if (!toItem && !(toEdge && edgeMayTarget(toEdge, board.edges))) return null;
        if (fromEdge) fromBlock = undefined;
        if (toEdge) toBlock = undefined;
        const props = serializeEdge({ from, to, dir, fromSide, toSide, fromBlock, toBlock });
        const existing = [...board.edges.values()].find((e) => e.from === from && e.to === to && (e.fromBlock ?? "") === (props.fromBlock ?? "") && (e.toBlock ?? "") === (props.toBlock ?? ""));
        if (existing && existing.dir === dir) return existing.uid;
        const container = ensureContainer(t);
        return t.create({ parent: container, order: "last", string: edgeStringFor(from, to, dir, label, props.fromBlock, props.toBlock), plexus: props });
      });
    },

    commitWhy(id, { label, why } = {}) {
      return txn((t) => {
        const edge = board.edges.get(id);
        if (!edge) return;
        const plan = whyPlan({ label, why, prevLabel: edge.label || "", prevWhy: edge.why || "" });
        for (const step of plan) {
          if (step.op === "label") t.string(id, edgeStringFor(edge.from, edge.to, edge.dir, step.label, edge.fromBlock, edge.toBlock));
          else if (step.op === "why") {
            if (edge.whyUid) t.string(edge.whyUid, step.text);
            else t.create({ parent: id, order: "first", string: step.text });
          } else if (step.op === "clear" && edge.whyUid) {
            // A why with notes under it is the user's outline: leave the block.
            if (edge.whyKids > 0) emit("toast", { message: "This why has notes under it. Edit it in the outline." });
            else t.del(edge.whyUid);
          }
        }
      });
    },

    createTrail(name, cardUids) {
      return txn((t) => {
        // The trail block, and the Trails container when this board does not have one yet, share the 45-write budget.
        const had = Boolean(board.trailsUid) || kidsOf(raw).some((k) => readPlexus(k[PROPS])?.type === "trails");
        const parent = ensureTrails(t);
        const id = t.create({ parent, order: "last", string: trailString(name), plexus: { type: "trail" }, open: true });
        const ids = [];
        for (const card of cardUids || []) if (card && board.items.has(card)) ids.push(card);
        const room = BULK_CARD_CAP - 1 - (had ? 0 : 1);
        for (const card of capBulk(ids, emit, room)) t.create({ parent: id, order: "last", string: `((${card}))`, open: true });
        return id;
      });
    },

    renameTrail(id, name) {
      return txn((t) => {
        if (!trailByUid(id)) return;
        t.string(id, trailString(name));
        const base = rawPlexus(id);
        if (base.type !== "trail") t.props(id, { ...base, type: "trail" });
      });
    },

    deleteTrail(id) {
      return txn((t) => {
        if (!trailByUid(id)) return;
        t.del(id);
      });
    },

    addToTrail(trailUid, cardUid, note) {
      return txn((t) => {
        if (!trailByUid(trailUid) || !cardUid) return null;
        const stop = t.create({ parent: trailUid, order: "last", string: `((${cardUid}))`, open: true });
        const text = typeof note === "string" ? note.trim() : "";
        if (text) t.create({ parent: stop, order: "first", string: text });
        return stop;
      });
    },

    addSelectionToTrail(trailUid, cardUids) {
      return txn((t) => {
        if (!trailByUid(trailUid)) return [];
        const ids = [];
        for (const id of cardUids || []) {
          if (!id || !board.items.has(id)) continue;
          ids.push(id);
        }
        const capped = capBulk(ids, emit);
        const made = [];
        for (const id of capped) made.push(t.create({ parent: trailUid, order: "last", string: `((${id}))`, open: true }));
        return made;
      });
    },

    moveStop(stopUid, finalIndex) {
      return txn((t) => {
        let parent = null;
        let from = -1;
        for (const trail of board.trails || []) {
          const at = (trail.stops || []).findIndex((s) => s.uid === stopUid);
          if (at >= 0) { parent = trail.uid; from = at; break; }
        }
        if (!parent) return;
        const index = Math.trunc(Number(finalIndex));
        if (!Number.isFinite(index)) { t.move(stopUid, parent, "last"); return; }
        const final = Math.max(0, index);
        if (final === from) return;
        // Roam counts a same-parent order with the moved block still in place: moving down needs one more.
        t.move(stopUid, parent, final > from ? final + 1 : final);
      });
    },

    // One id, or a list. A list is one gesture and stops at 45.
    setLandmark(id, { on, glyph, size } = {}) {
      const list = Array.isArray(id) ? id : [id];
      return txn((t) => {
        const ids = [];
        const seen = new Set();
        for (const one of list) {
          if (!one || seen.has(one) || !board.items.get(one)) continue;
          seen.add(one);
          ids.push(one);
        }
        for (const one of capBulk(ids, emit)) {
          const item = board.items.get(one);
          const nextOn = on === undefined ? item.landmark === true : Boolean(on);
          if (!nextOn) {
            t.props(one, itemPlexus(one, { landmark: false, glyph: "", size: undefined }));
            continue;
          }
          const patch = { landmark: true };
          if (glyph !== undefined) patch.glyph = glyph;
          else if (item.glyph) patch.glyph = item.glyph;
          if (size !== undefined) patch.size = size;
          else if (item.size === "S" || item.size === "L") patch.size = item.size;
          t.props(one, itemPlexus(one, patch));
        }
      });
    },

    updateEdge(id, patch = {}) {
      return txn((t) => {
        const edge = board.edges.get(id);
        if (!edge) return;
        const { label, ...rest } = patch;
        const nextFrom = rest.from ?? edge.from;
        const nextTo = rest.to ?? edge.to;
        // A label edit on an arrow whose card is already missing still saves. Retargeting does not.
        if (rest.from !== undefined || rest.to !== undefined) {
          if (!nextFrom || !nextTo || nextFrom === nextTo || nextFrom === id || nextTo === id) return;
          const fromEdge = board.items.has(nextFrom) ? null : board.edges.get(nextFrom);
          const toEdge = board.items.has(nextTo) ? null : board.edges.get(nextTo);
          if (fromEdge && toEdge) return;
          if (fromEdge && !edgeMayTarget(fromEdge, board.edges)) return;
          if (toEdge && !edgeMayTarget(toEdge, board.edges)) return;
          if (!board.items.has(nextFrom) && !fromEdge) return;
          if (!board.items.has(nextTo) && !toEdge) return;
        }
        const next = edgePlexus(id, rest);
        t.props(id, next);
        const dir = rest.dir ?? edge.dir;
        const nextLabel = label ?? edge.label;
        const merged = normalizeEdge(next);
        const blocksChanged = (merged.fromBlock ?? "") !== (edge.fromBlock ?? "") || (merged.toBlock ?? "") !== (edge.toBlock ?? "");
        if (rest.dir !== undefined && rest.dir !== edge.dir || label !== undefined && label !== edge.label || blocksChanged || nextFrom !== edge.from || nextTo !== edge.to) {
          t.string(id, edgeStringFor(nextFrom, nextTo, dir, nextLabel, merged.fromBlock, merged.toBlock));
        }
      });
    },

    flipEdge(id) {
      return txn((t) => {
        const edge = board.edges.get(id);
        if (!edge) return;
        t.props(id, edgePlexus(id, { from: edge.to, to: edge.from, fromSide: edge.toSide, toSide: edge.fromSide, fromBlock: edge.toBlock, toBlock: edge.fromBlock }));
        t.string(id, edgeStringFor(edge.to, edge.from, edge.dir, edge.label, edge.toBlock, edge.fromBlock));
      });
    },

    deleteEdges(uids) {
      return txn((t) => { removeEdges(t, uids); });
    },

    // The outline's own Delete: the region and every arrow that ends on it, one undo.
    deleteRegion(regionUid) {
      return txn((t) => {
        const id = String(regionUid || "");
        if (!imageRegionBlock(id)) return;
        const edges = [];
        for (const edge of board.edges.values()) {
          if (edge.fromBlock === id || edge.toBlock === id) edges.push(edge.uid);
        }
        removeEdges(t, edges, { force: new Set([id]) });
      });
    },

    setRegionCaption(uid, caption) {
      return txn((t) => {
        let current = "";
        try { current = host.blockString?.(uid) || ""; } catch { return; }
        const next = renameRegionCaption(current, caption);
        if (!next || next === current) return;
        t.string(uid, next);
      });
    },

    // Region outline plus the arrow, one undo. The region lives under the source image,
    // which may be a block the card only references. A page the user cannot write is refused.
    addRegionEndpoint({ from, to, frac, fromBlock, fromSide, toSide, label = "", poly } = {}) {
      return txn((t) => {
        if (!from || !to || from === to || !board.items.has(from) || !board.items.has(to)) return null;
        const regionUid = writeImageRegion(t, board.items.get(to), frac, label, undefined, poly);
        if (!regionUid) return null;
        const container = ensureContainer(t);
        return t.create({
          parent: container,
          order: "last",
          string: edgeStringFor(from, to, "one", label, fromBlock, regionUid),
          plexus: serializeEdge({ from, to, dir: "one", fromSide, toSide, fromBlock, toBlock: regionUid }),
        });
      });
    },

    // A region alone, under the card's source image, with a known uid so an arrow can start from it at once.
    addRegionOn({ on, frac, uid, label = "", poly } = {}) {
      return txn((t) => {
        if (!on || !board.items.has(on)) return null;
        return writeImageRegion(t, board.items.get(on), frac, label, uid, poly);
      });
    },

    pinLink(link) {
      const first = link?.labels?.[0];
      const label = first && first !== "mentions" ? first : "";
      return session.addEdge({ from: link.from, to: link.to, label, dir: "one" });
    },

    async writeToGraph(edgeUid) {
      const edge = board?.edges.get(edgeUid);
      if (!edge) return { ok: false, reason: "unresolved" };
      const label = String(edge.label ?? "").trim();
      if (!label) return { ok: false, reason: "empty-label" };
      if (label.includes("::")) return { ok: false, reason: "invalid-label" };
      if (/^BT_attr/i.test(label)) return { ok: false, reason: "reserved-label" };
      if (label.length > 60) return { ok: false, reason: "too-long" };
      const src = board.items.get(edge.from);
      const dst = board.items.get(edge.to);
      if (!src || !dst) return { ok: false, reason: "unresolved" };
      const dstRef = edge.toBlock ? `((${edge.toBlock}))` : semanticRef(dst);
      let stamp = stampList();
      const write = (fn) => {
        const list = stamp;
        stamp = [];
        return list.length ? stampedRun(list, fn) : queue.run(fn);
      };
      try {
        if (src.kind === "page") {
          const page = host.pullPage(src.target.title);
          if (!page) return { ok: false, reason: "no-page" };
          const attr = kidsOf(page).find((k) => String(k[STR] ?? "").trim() === `${label}::`);
          if (attr) {
            await write(() => host.createBlock({ parentUid: attr[UID], order: "last", string: dstRef }));
            return { ok: true, reason: "appended" };
          }
          await write(() => host.createBlock({ parentUid: page[UID], order: "last", string: `${label}:: ${dstRef}` }));
          return { ok: true, reason: "created" };
        }
        const srcUid = src.kind === "block" ? src.target.uid : src.uid;
        if (host.blockString(srcUid) == null) return { ok: false, reason: "unresolved" };
        await write(() => host.createBlock({ parentUid: srcUid, order: "last", string: `${label}:: ${dstRef}` }));
        return { ok: true, reason: "created" };
      } catch (err) {
        emit("toast", { message: "Couldn't write the connection to the graph." });
        return { ok: false, reason: "write-failed" };
      }
    },

    async undo() {
      try {
        await queue.run(async () => { ledger.clear(); await host.undo(); });
        repull();
      } catch (err) { handleFailure(err); }
    },

    async redo() {
      try {
        await queue.run(async () => { ledger.clear(); await host.redo(); });
        repull();
      } catch (err) { handleFailure(err); }
    },

    async enhance() {
      if (!board) return { enhanced: false, reason: "no-board" };
      if (board.virtual) {
        await txn((t) => { t.props(uid, withBoardMarker(rawPlexus(uid), true)); });
        return { enhanced: true, kind: "virtual", counts: null };
      }
      if (board.enhanced) return { enhanced: false, reason: "already" };
      // Restore leaves the edited item props in place. Importing again would overwrite that layout and duplicate connections.
      if (hasStoredLayout()) {
        await txn((t) => { t.props(uid, withBoardMarker(rawPlexus(uid), true)); });
        return { enhanced: true, kind: "kept", counts: null };
      }
      let source = readV06Entry(host, uid);
      let kind = "v06";
      if (!source) {
        const native = readNative(host, uid);
        source = native.nodes.length ? native : null;
        kind = source ? "native" : "none";
      }
      const plan = planImport(board, source, { gen: () => host.generateUid() });
      // Roam skips a collapsed block's children, so an open board with an outline is collapsed in the same run.
      const collapse = collapseOutline() && raw?.[OPEN] !== false;
      let counts = null;
      try {
        counts = await queue.run(() => grouped(async () => {
          ledger.clear();
          const done = await executeImport(plan, host, board);
          if (collapse) await host.setOpen(uid, false);
          return done;
        }));
      } catch (err) {
        handleFailure(err);
        return { enhanced: false, reason: "write-failed" };
      }
      repull();
      return { enhanced: true, kind, counts };
    },

    setHighlighterTags(on) {
      return txn((t) => { t.props(uid, { ...rawPlexus(uid), highlighterTags: on === true }); });
    },

    allowVirtual() {
      if (destroyed) return;
      virtualAllowed = true;
      publish();
    },

    restoreNative() {
      return txn((t) => { t.props(uid, withBoardMarker(rawPlexus(uid), false)); });
    },

    // A second mount of this board. The watch stays up when it is already live.
    retain() {
      if (destroyed) return;
      holders += 1;
      syncBoardWatch(true);
      unparkLinks();
    },

    // Drop this holder's pull watch without destroying the session.
    pauseWatches() {
      if (destroyed || pausedHolds >= holders) return;
      pausedHolds += 1;
      syncBoardWatch(false);
      if (linksParked()) parkLinks();
    },

    // Put the watch back. One pullBoard applies edits that landed while paused.
    resumeWatches() {
      if (destroyed || pausedHolds <= 0) return;
      pausedHolds -= 1;
      const wasOn = boardWatchOn && !boardWatchHeld;
      syncBoardWatch(!boardWatchOn);
      if (wasOn) catchUpBoard();
      unparkLinks();
    },

    // A ref is leaving. A paused ref already dropped its watch hold.
    forget(opts) {
      if (destroyed || holders <= 0) return;
      if (opts?.paused === true && pausedHolds > 0) pausedHolds -= 1;
      holders -= 1;
      if (holders === 0) return;
      syncBoardWatch(false);
      unparkLinks();
    },

    release() { /* replaced by acquireSession */ },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (boardWatchOn) {
        boardWatchOn = false;
        boardWatchHeld = false;
        try { boardWatch(); } catch { /* already dropped */ }
      }
      boardWatch = () => {};
      if (resumeRetry != null) { clearTimeout(resumeRetry); resumeRetry = null; }
      if (highlightHoldTimer != null) { clearTimeout(highlightHoldTimer); highlightHoldTimer = null; }
      disposeHighlightWatches();
      cancelScheduledLinks();
      linkResolve?.();
      linkPromise = null;
      linkResolve = null;
      listeners.clear();
      ledger.clear();
    },
  };

  // A nested board is one card block: the board string plus its layout and `v: 2` in a single create.
  function makeBoard(t, rect, title, exclude, centerOf = rect) {
    const parent = containerAt(board, { x: centerOf.x + centerOf.w / 2, y: centerOf.y + centerOf.h / 2 }, { rects, exclude });
    const rel = toRelative(board, parent, { x: rect.x, y: rect.y }, rects);
    return t.create({
      parent,
      string: boardString(title),
      plexus: serializeItemLayout({ x: rel.x, y: rel.y, w: rect.w, h: rect.h, v: SCHEMA_VERSION }),
      open: collapseOutline() ? false : undefined,
    });
  }

  // Moves top-level items into a child board (rebased to its origin) and re-homes the connections that follow.
  function moveItemsInto(t, top, boardUid, origin, place, track = {}) {
    const moved = track.moved ?? new Set([...top].flatMap((id) => [id, ...descendantsOf(board, id)]));
    // A nested board that is only virtual (auto-enhance) gets its marker with the first card moved into it.
    if (rawPlexus(boardUid).v !== SCHEMA_VERSION) t.props(boardUid, withBoardMarker(rawPlexus(boardUid), true));
    for (const id of top) {
      const r = rects.get(id);
      t.move(id, boardUid, insertOrder(boardUid));
      t.props(id, itemPlexus(id, { x: round1(r.x - origin.x + place.x), y: round1(r.y - origin.y + place.y) }));
    }
    let childContainer = null;
    const childEdges = () => {
      if (childContainer) return childContainer;
      const existing = kidsOf(rawNode(boardUid)).find((k) => readPlexus(k[PROPS])?.type === "edges");
      if (existing) { childContainer = existing[UID]; return childContainer; }
      childContainer = t.create({ parent: boardUid, order: "last", string: "Connections", plexus: { type: "edges" }, open: false });
      if (track.info) track.info.createdContainer = childContainer;
      return childContainer;
    };
    const taken = new Set();
    // Snapshot first: moving one edge out renumbers its siblings, and undo needs the original positions.
    const touched = [...board.edges.values()].filter((e) => moved.has(e.from) || moved.has(e.to));
    const snapshots = new Map();
    for (const e of touched) {
      const hit = ix().get(e.uid);
      if (hit?.parent) {
        snapshots.set(e.uid, { uid: e.uid, parent: hit.parent[UID], order: kidsOf(hit.parent).indexOf(hit.node), plexus: clone(readPlexus(hit.node[PROPS])), string: hit.node[STR] ?? "" });
      }
    }
    for (const e of touched) {
      const snapshot = snapshots.get(e.uid);
      if (snapshot) track.undoEdges?.push(snapshot);
      if (moved.has(e.from) && moved.has(e.to)) {
        if (snapshot) snapshot.relocated = true;
        t.move(e.uid, childEdges(), "last");
        continue;
      }
      const from = moved.has(e.from) ? boardUid : e.from;
      const to = moved.has(e.to) ? boardUid : e.to;
      const dup = findEdge(board, from, to);
      const key = `${from}>${to}`;
      if (from === to || (dup && dup.uid !== e.uid) || taken.has(key)) {
        if (snapshot) snapshot.deleted = true;
        t.del(e.uid);
        continue;
      }
      taken.add(key);
      const fromBlock = moved.has(e.from) ? undefined : e.fromBlock;
      const toBlock = moved.has(e.to) ? undefined : e.toBlock;
      t.props(e.uid, edgePlexus(e.uid, { from, to, fromSide: moved.has(e.from) ? "auto" : e.fromSide, toSide: moved.has(e.to) ? "auto" : e.toSide, fromBlock, toBlock }));
      t.string(e.uid, edgeStringFor(from, to, e.dir, e.label, fromBlock, toBlock));
    }
  }

  function makeSection(t, rect, title, color, adopt, lane) {
    const parent = containerAt(board, { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }, { rects });
    const rel = toRelative(board, parent, { x: rect.x, y: rect.y }, rects);
    const members = adopt ?? itemsInRect(board, rect, rects, { mode: "contain" });
    const size = clampSize("section", rect.w, rect.h);
    const layout = { type: "section", x: rel.x, y: rel.y, w: size.w, h: size.h, color };
    if (lane?.look === "lane") {
      layout.look = "lane";
      layout.axis = lane.axis === "vertical" ? "vertical" : "horizontal";
    }
    const sectionUid = t.create({
      parent,
      string: title,
      plexus: serializeItemLayout(layout),
    });
    for (const id of members) {
      if (id === sectionUid) continue;
      const r = rects.get(id);
      t.move(id, sectionUid, "last");
      t.props(id, itemPlexus(id, { x: round1(r.x - rect.x), y: round1(r.y - rect.y) }));
    }
    return sectionUid;
  }

  if (linkMode !== "off" && board) refreshLinks();

  const api = {
    uid,
    host,
    settings,
    txn,
    bulkAllowed,
    rawNode,
    ix,
    kidsOf,
    rawPlexus,
    itemPlexus,
    edgePlexus,
    insertOrder,
    ensureContainer,
    edgeStringFor,
    refOf,
    applyFit,
    board: () => board,
    rects: () => rects,
    queue,
    isGone: () => gone || destroyed,
    setting,
    clone,
    round1,
    emit,
  };
  for (const fn of [...extensions]) {
    try { fn(session, api); } catch (err) { console.error("[plexus session] extension", err); }
  }
  return session;
}

export function acquireSession(boardUid, options = {}) {
  const { host } = options;
  const entry = registry.get(boardUid);
  if (entry && entry.host === host) {
    entry.refs++;
    if (options.virtual === true) entry.session.allowVirtual?.();
    entry.session.retain?.();
    return entry.session;
  }
  if (entry) {
    entry.session.destroy();
    registry.delete(boardUid);
  }
  const session = createSession(boardUid, options);
  const record = { host, session, refs: 1 };
  registry.set(boardUid, record);
  session.release = (opts) => {
    if (registry.get(boardUid) !== record || record.refs <= 0) return;
    record.refs--;
    if (record.refs === 0) {
      session.destroy();
      registry.delete(boardUid);
      return;
    }
    session.forget?.(opts);
  };
  return session;
}

// True when acquireSession(boardUid) with this host would reuse a live session (no board read).
export function hasSession(boardUid, host) {
  const entry = registry.get(boardUid);
  return Boolean(entry && entry.host === host);
}

export function resetSessions() {
  for (const record of [...registry.values()]) record.session.destroy();
  registry.clear();
}
