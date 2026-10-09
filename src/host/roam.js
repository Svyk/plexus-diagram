import { isShowableCard, locateShowTarget } from "../model/deeplink.js";
import { attributeRows, boardsFromRows, tagNames } from "../model/info.js";
import {
  isDailyTitle,
  libraryCap,
  libraryCard,
  librarySelective,
  narrowLibrary,
  normalizeLibraryFilter,
  recentDailyTitles,
} from "../model/library.js";
import { splitNeighbors } from "../model/neighbors.js";
import { coverModel, pdfMacroUrl, pdfPagePlan } from "../model/pdf.js";
import { LINKED_REF_CAP } from "../model/refs.js";
import { createCardCache } from "../model/card-cache.js";
import { attrNameOf, classifyString, mergePropsForWrite, parseBoardTitle, plainKeys } from "../model/schema.js";
import { dailyTitle, dailyUid, journalRows } from "../model/journal.js";
import { closeTab, normalizeTabs, openTab, tabStorageKey } from "../model/tabs.js";
import { bindGuardStats, guardCallback } from "../guard.js";

export const BOARD_PATTERN = `[:block/uid :block/string :block/order :block/heading :block/open :block/props
 {:block/children [:block/uid :block/string :block/order :block/heading :block/open :block/props
   {:block/children [:block/uid :block/string :block/order :block/heading :block/open :block/props
     {:block/children ...}]}]}]`;

// One pull of the board also brings card refs, page outlines, and native diagram attrs.
// The inner `...` repeats that level only, so a page outline does not pull refs of refs.
const REF_CHILD = `[:block/uid :block/string :block/order :block/heading :block/open :block/props
 {:block/children [:block/uid :block/string :block/order :block/heading :block/open :block/props
   {:block/children ...}]}]`;
const NATIVE_PULL = `{:diagram/nodes [:db/id :diagram.node/data {:diagram.node/block [:block/uid :block/string]} {:diagram.node/parent-node [:db/id]}]}
 {:diagram/edges [{:diagram.edge/source [:db/id]} {:diagram.edge/target [:db/id]} :diagram.edge/data]}`;
const REF_BODY = `[:db/id :block/uid :block/string :node/title :block/order :block/heading :block/open :block/props :pdf/url
 {:block/page [:node/title :block/uid :pdf/url]}
 ${NATIVE_PULL}
 {:block/children ${REF_CHILD}}]`;
const OPEN_PATTERN = `[:db/id :block/uid :block/string :block/order :block/heading :block/open :block/props
 {:block/page [:block/uid :pdf/url]}
 {:block/parents [:block/uid :block/string :block/props {:block/parents [:db/id]}]}
 ${NATIVE_PULL}
 {:block/refs ${REF_BODY}}
 {:block/children [:db/id :block/uid :block/string :block/order :block/heading :block/open :block/props
   {:block/refs ${REF_BODY}}
   ${NATIVE_PULL}
   {:block/children [:db/id :block/uid :block/string :block/order :block/heading :block/open :block/props
     {:block/refs ${REF_BODY}}
     ${NATIVE_PULL}
     {:block/children ...}]}]}]`;

const LINKED_MANY = `[:find ?title ?u ?ss ?pt :in $ [?title ...] :where
 [?p :node/title ?title] [?b :block/refs ?p] [?b :block/uid ?u] [?b :block/string ?ss] [?b :block/page ?pg] [?pg :node/title ?pt]]`;

function childNodes(node) {
  const kids = node?.[":block/children"];
  return Array.isArray(kids) ? kids : [];
}

function pageNodeOf(node) {
  const page = node?.[":block/page"];
  const one = Array.isArray(page) ? page[0] : page;
  return one && typeof one === "object" ? one : null;
}

// The board's page is :block/page when the pull has it, otherwise the parent the open pattern names.
function inferBoardPage(node) {
  const page = pageNodeOf(node);
  const pageId = page?.[":block/uid"];
  if (typeof pageId === "string" && pageId) return pageId;
  const parents = node?.[":block/parents"];
  const list = Array.isArray(parents) ? parents : (parents && typeof parents === "object" ? [parents] : []);
  for (const parent of list) {
    const id = parent?.[":block/uid"];
    if (typeof id === "string" && id) return id;
  }
  return "";
}

function refNodes(node) {
  const refs = node?.[":block/refs"];
  if (!refs) return [];
  return Array.isArray(refs) ? refs : [refs];
}

function hasRefs(node) {
  const stack = [node];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    if (refNodes(cur).length) return true;
    for (const kid of childNodes(cur)) stack.push(kid);
  }
  return false;
}

function uniqueStrings(list) {
  const out = [];
  const seen = new Set();
  for (const value of list) {
    if (typeof value !== "string" || value === "" || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

// Page cards and block refs named by card strings. Nested outline rows are not cards.
function collectTargets(node) {
  const titles = [];
  const uids = [];
  const stats = [];
  const walk = (cur, isRoot) => {
    if (!cur || typeof cur !== "object") return;
    if (!isRoot) {
      const uid = cur[":block/uid"];
      if (typeof uid === "string" && uid) stats.push({ kind: "block", uid });
      const cls = classifyString(cur[":block/string"] ?? "");
      if (cls.kind === "page" && cls.title) {
        titles.push(cls.title);
        stats.push({ kind: "page", title: cls.title });
      } else if (cls.kind === "block" && cls.refUid) {
        uids.push(cls.refUid);
        stats.push({ kind: "block", uid: cls.refUid });
      }
    }
    for (const kid of childNodes(cur)) walk(kid, false);
  };
  walk(node, true);
  return { titles: uniqueStrings(titles), uids: uniqueStrings(uids), stats };
}

function unpackPulls(rows) {
  const out = [];
  for (const row of rows || []) {
    const cell = Array.isArray(row) ? row[0] : row;
    if (cell && typeof cell === "object" && !Array.isArray(cell)) out.push(cell);
  }
  return out;
}

const ciPattern = (text) => `(?i)${String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`;

export const NATIVE_PATTERN = `[:block/props
 {:diagram/nodes [:db/id :diagram.node/data {:diagram.node/block [:block/uid :block/string]} {:diagram.node/parent-node [:db/id]}]}
 {:diagram/edges [{:diagram.edge/source [:db/id]} {:diagram.edge/target [:db/id]} :diagram.edge/data]}]`;

const DIAGRAM_RE = "^\\{\\{(\\[\\[)?diagram";
const DIAGRAM_STRING = /^\s*\{\{(?:\[\[)?diagram/i;
const DIAGRAM_FIND = new RegExp(DIAGRAM_RE);
// Index lookup. A `[?t ...]` binding on :block/refs scans every refs datom in the graph.
const STATS_PULL = `[:db/id {:block/_refs [:db/id {:block/parents [:db/id :block/string]}]} {:block/_parents [:db/id {:block/refs [:db/id]}]} {:block/_page [:db/id {:block/refs [:db/id]}]}]`;

function listOf(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function refEid(node) {
  if (typeof node === "number") return node;
  if (node && typeof node === "object" && node[":db/id"] != null) return node[":db/id"];
  return null;
}

// Same pattern the datalog fallback hands to re-pattern: anchored, case-sensitive, no space trim.
function isDiagramBlock(node) {
  const text = node?.[":block/string"];
  return typeof text === "string" && DIAGRAM_FIND.test(text);
}

function pullRows(many) {
  if (Array.isArray(many)) return many;
  if (many && typeof many === "object" && typeof many.length === "number") return Array.from(many);
  return null;
}
const SHOW_DIRECT_QUERY = `[:find ?board ?page :in $ ?uid ?pat :where
 [?block :block/uid ?uid] [?block :block/parents ?diagram] [?diagram :block/uid ?board]
 [?diagram :block/string ?s] [(re-pattern ?pat) ?re] [(re-find ?re ?s)]
 [?diagram :block/page ?p] [?p :block/uid ?page]]`;
const SHOW_REF_QUERY = `[:find ?board ?page ?card :in $ ?uid ?pat :where
 [?target :block/uid ?uid] [?cardblock :block/refs ?target] [?cardblock :block/uid ?card]
 [?cardblock :block/parents ?diagram] [?diagram :block/uid ?board] [?diagram :block/string ?s]
 [(re-pattern ?pat) ?re] [(re-find ?re ?s)] [?diagram :block/page ?p] [?p :block/uid ?page]]`;
const BOARD_META_PATTERN = "[:block/props :edit/time {:block/children [:block/props]}]";
const PDF_PAGE_QUERY = `[:find ?u ?t :in $ ?url :where [?p :pdf/url ?url] [?p :block/uid ?u] [?p :node/title ?t]]`;
const PDF_PAGE_BLOCKS_QUERY = `[:find ?props :in $ ?uid :where [?p :block/uid ?uid] [?b :block/page ?p] [?b :block/props ?props]]`;
const PDF_BLOCK_OUT_QUERY = `[:find ?u :in $ ?page ?url :where [?p :block/uid ?page] [?p :block/refs ?b] [?b :block/string ?s] [(clojure.string/includes? ?s ?url)] [?b :block/uid ?u]]`;
const PDF_BLOCK_IN_QUERY = `[:find ?u :in $ ?page ?url :where [?p :block/uid ?page] [?b :block/refs ?p] [?b :block/string ?s] [(clojure.string/includes? ?s ?url)] [?b :block/uid ?u]]`;
const BLOCK_PROPS_PATTERN = "[:block/string :block/props {:block/page [:node/title]}]";
// Children too, so a highlight card sees its note change. The string path ignores child-only fires.
const BLOCK_WATCH_PATTERN = "[:block/string {:block/children [:block/string :block/order :block/props]}]";
const HIGHLIGHT_TREE_PATTERN = `[:block/uid
 {:block/children [:block/uid :block/string :block/order :block/props
   {:block/children [:block/uid :block/string :block/order :block/props
     {:block/children [:block/uid :block/string :block/order :block/props
       {:block/children [:block/uid :block/string :block/order :block/props]}]}]}]}]`;

const eidKey = (uid) => [":block/uid", uid];
const watchEntity = (uid) => `[:block/uid "${String(uid).replace(/["\\]/g, "")}"]`;

function sortedKids(node) {
  const kids = Array.isArray(node?.[":block/children"]) ? node[":block/children"] : [];
  return kids
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (a.c[":block/order"] ?? a.i) - (b.c[":block/order"] ?? b.i) || a.i - b.i)
    .map(({ c }) => c);
}

function trimTree(node, depth, budget) {
  const out = [];
  if (depth < 1) return out;
  for (const c of sortedKids(node)) {
    if (budget.left <= 0) break;
    budget.left--;
    out.push({
      uid: c[":block/uid"],
      string: c[":block/string"] ?? "",
      ...(c[":block/open"] === false ? { open: false } : {}),
      children: trimTree(c, depth - 1, budget),
    });
  }
  return out;
}

function highlightTreeNodes(node) {
  const out = [];
  for (const child of sortedKids(node)) {
    const uid = child[":block/uid"];
    const string = child[":block/string"];
    const props = child[":block/props"];
    out.push({
      uid: typeof uid === "string" ? uid : "",
      string: typeof string === "string" ? string : "",
      props: props && typeof props === "object" && !Array.isArray(props) ? props : {},
      children: highlightTreeNodes(child),
    });
  }
  return out;
}

export function graphName(hash = globalThis.location?.hash ?? "") {
  const m = /#\/app\/([^/?#]+)/.exec(hash);
  return m ? decodeURIComponent(m[1]) : "";
}

// What a pull pattern asks for: top-level attributes, and one level under each map key.
// The board cache was filled with patterns that always ask for these, so their absence on a cached node
// is Roam's answer, not a gap. Any other attribute must be on the node, or the pull goes to Roam.
const CACHE_ASKED = new Set([":block/uid", ":block/string", ":block/order", ":block/heading", ":block/open", ":block/props", ":block/children"]);
const patternMemo = new Map();
export function patternNeeds(pattern) {
  const text = String(pattern ?? "");
  const hit = patternMemo.get(text);
  if (hit) return hit;
  const tokens = text.match(/\.\.\.|[[\]{}]|:[^\s[\]{}]+|[^\s[\]{}]+/g) || [];
  let i = 0;
  const vector = () => {
    const out = [];
    if (tokens[i] !== "[") return out;
    i += 1;
    while (i < tokens.length && tokens[i] !== "]") {
      const t = tokens[i];
      if (t === "{") {
        i += 1;
        while (i < tokens.length && tokens[i] !== "}") {
          const key = tokens[i];
          i += 1;
          let sub = null;
          if (tokens[i] === "[") sub = vector();
          else i += 1; // `...` or a recursion limit
          out.push({ key, sub });
        }
        i += 1;
      } else if (t === "[") vector();
      else { if (t.startsWith(":")) out.push({ attr: t }); i += 1; }
    }
    i += 1;
    return out;
  };
  const needs = vector();
  if (patternMemo.size > 200) patternMemo.clear();
  patternMemo.set(text, needs);
  return needs;
}

function nodeAnswers(node, needs) {
  for (const need of needs) {
    if (need.attr) {
      if (!(need.attr in node) && !CACHE_ASKED.has(need.attr)) return false;
      continue;
    }
    const value = node[need.key];
    if (value == null) {
      if (!CACHE_ASKED.has(need.key)) return false;
      continue;
    }
    if (!need.sub) continue;
    const first = Array.isArray(value) ? value[0] : value;
    if (first && typeof first === "object") {
      for (const inner of need.sub) {
        if (inner.attr && !(inner.attr in first) && !CACHE_ASKED.has(inner.attr)) return false;
        if (inner.key && first[inner.key] == null && !CACHE_ASKED.has(inner.key)) return false;
      }
    }
  }
  return true;
}

export function createWriteQueue({ onBusy } = {}) {
  let tail = Promise.resolve();
  let pending = 0;
  let waiters = [];
  return {
    run(fn) {
      pending++;
      if (pending === 1) onBusy?.(true);
      const p = tail.then(async () => {
        try {
          return await fn();
        } finally {
          pending--;
          if (pending === 0) {
            onBusy?.(false);
            const w = waiters;
            waiters = [];
            w.forEach((r) => r());
          }
        }
      });
      tail = p.then(() => {}, () => {});
      return p;
    },
    get pending() { return pending; },
    idle() {
      if (pending === 0) return Promise.resolve();
      return new Promise((resolve) => waiters.push(resolve));
    },
  };
}

const canon = (v) => (typeof v === "string" ? v : JSON.stringify(v));

export function createEchoLedger({ graceMs = 800, now = Date.now } = {}) {
  const state = new Map(); // `${uid}\u0000${field}` -> {pending:[], inflight, graceUntil}
  const keyOf = (uid, field) => `${uid}\u0000${field}`;
  const get = (uid, field, create) => {
    const k = keyOf(uid, field);
    let s = state.get(k);
    if (!s && create) { s = { uid, field, pending: [], inflight: 0, graceUntil: 0 }; state.set(k, s); }
    return s;
  };
  return {
    expect(uid, field, value) {
      const s = get(uid, field, true);
      s.pending.push(canon(value));
      s.inflight++;
    },
    settle(uid, field) {
      const s = get(uid, field, false);
      if (!s) return;
      s.inflight = Math.max(0, s.inflight - 1);
      if (s.inflight === 0) s.graceUntil = now() + graceMs;
    },
    accept(uid, field, value) {
      const k = keyOf(uid, field);
      const s = state.get(k);
      if (!s) return true;
      const v = canon(value);
      const idle = s.inflight === 0;
      if (idle && now() >= s.graceUntil) { state.delete(k); return true; }
      const idx = s.pending.lastIndexOf(v);
      if (idx >= 0 && idx === s.pending.length - 1) {
        s.pending = [];
        if (idle) s.graceUntil = now() + graceMs;
        return false;
      }
      return false;
    },
    tracked() { return [...state.values()].map((s) => [s.uid, s.field]); },
    pendingCount(uid) {
      let n = 0;
      for (const s of state.values()) if (s.uid === uid) n += s.pending.length + s.inflight;
      return n;
    },
    clear() { state.clear(); },
  };
}

export function createViewportStore({ storage = globalThis.localStorage, graph = "", now = Date.now } = {}) {
  const key = (uid) => `plexus-diagram:vp:${graph}:${uid}`;
  const lastWrite = new Map();
  const latest = new Map();
  const timers = new Map();
  const flush = (uid) => {
    timers.delete(uid);
    if (!latest.has(uid)) return;
    try { storage?.setItem(key(uid), JSON.stringify(latest.get(uid))); } catch { /* quota or private mode */ }
    lastWrite.set(uid, now());
    latest.delete(uid);
  };
  return {
    get(uid) {
      try {
        const raw = storage?.getItem(key(uid));
        if (!raw) return null;
        const v = JSON.parse(raw);
        return Number.isFinite(v?.x) && Number.isFinite(v?.y) && Number.isFinite(v?.zoom) ? v : null;
      } catch { return null; }
    },
    set(uid, vp) {
      if (!vp) return;
      latest.set(uid, { x: vp.x, y: vp.y, zoom: vp.zoom });
      const since = now() - (lastWrite.get(uid) ?? -Infinity);
      if (since >= 500) { flush(uid); return; }
      if (!timers.has(uid)) {
        const t = setTimeout(() => flush(uid), 500 - since);
        t.unref?.();
        timers.set(uid, t);
      }
    },
    flushAll() {
      for (const [uid, t] of timers) { clearTimeout(t); flush(uid); }
    },
    dispose() {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      latest.clear();
    },
  };
}

// Fullscreen board tabs. One key per graph. Writes immediately: opening a tab is one gesture, not a pan.
export function createTabStore({ storage = globalThis.localStorage, graph = "" } = {}) {
  const key = tabStorageKey(graph);
  const read = () => {
    try {
      const raw = storage?.getItem?.(key);
      if (!raw) return [];
      return normalizeTabs(JSON.parse(raw));
    } catch { return []; }
  };
  const write = (tabs) => {
    try { storage?.setItem?.(key, JSON.stringify(normalizeTabs(tabs))); } catch { /* quota or private mode */ }
  };
  return {
    get: read,
    set(tabs) { write(tabs); },
    open(entry) {
      const next = openTab(read(), entry);
      write(next.tabs);
      return next;
    },
    close(uid) {
      const next = closeTab(read(), uid);
      write(next.tabs);
      return next;
    },
  };
}

function hasPdfHighlight(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value).includes(":pdf-highlight") || Object.keys(value).includes("pdf-highlight");
}

function queryRows(host, query, ...inputs) {
  try {
    const rows = host.q(query, ...inputs);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

// Extra Roam undo entries createTableFromModel produces beyond returnInfo.writes
// when enhance is on. returnInfo.writes counts the table only (1 on the markdown
// path). MetadataStore.set is one createBlock on a warm roam/grid/metadata page,
// so the default is 1: two Roam undos inside Roam Grid, plus one Plexus props write.
// Live 2026-10-07 on Readwisenotes Test Lab (xxnGb6SEj): fromMarkdown of a 3×3
// returned { uids: [root] } in 16 ms, and one data.undo removed that root while
// the scratch parent stayed. window.roamGrid.v1 was loaded but had no
// createTableFromModel and no capabilities array, so this constant is still the
// source default. Measure it when that method is on the graph and change this one line.
export const GRID_METADATA_UNDOS = 1;

function roamGridV1() {
  const holders = [];
  if (typeof globalThis.window !== "undefined" && globalThis.window) holders.push(globalThis.window);
  holders.push(globalThis);
  for (const holder of holders) {
    const v1 = holder?.roamGrid?.v1;
    if (!v1 || typeof v1.createTableFromModel !== "function") continue;
    const caps = v1.capabilities;
    if (Array.isArray(caps) && caps.includes("createTableFromModel")) return v1;
  }
  return null;
}

// toGridSpec speaks in arrays (headerRows indexes, alignments [{col, align}]).
// createTableFromModel wants headerRows as an integer count and columnAlignments
// as a per-column array. Passing the arrays through throws.
function gridModelArgs(spec) {
  const src = spec && typeof spec === "object" ? spec : {};
  const rows = Array.isArray(src.rows) ? src.rows : [];
  const headerRows = Array.isArray(src.headerRows)
    ? src.headerRows.length
    : (Number.isInteger(src.headerRows) && src.headerRows > 0 ? src.headerRows : 0);
  const args = {
    rows,
    merges: Array.isArray(src.merges) ? src.merges : [],
    headerRows,
    enhance: src.enhance !== false,
    returnInfo: true,
  };
  if (src.parentUid) args.parentUid = src.parentUid;
  if (src.afterUid) args.afterUid = src.afterUid;
  if (src.order !== undefined) args.order = src.order;
  if (Array.isArray(src.columnAlignments)) args.columnAlignments = src.columnAlignments;
  else if (Array.isArray(src.alignments) && src.alignments.length) {
    const cols = rows.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0);
    const columnAlignments = Array.from({ length: cols }, () => null);
    for (const entry of src.alignments) {
      if (!entry || !Number.isInteger(entry.col) || entry.col < 0 || entry.col >= cols) continue;
      columnAlignments[entry.col] = entry.align ?? null;
    }
    args.columnAlignments = columnAlignments;
  } else if (src.alignments && typeof src.alignments === "object") args.alignments = src.alignments;
  if (src.widths && typeof src.widths === "object") args.widths = src.widths;
  return args;
}

function markdownRootUids(result) {
  const raw = result?.uids || result?.blocks || result?.rootUids || (Array.isArray(result) ? result : []);
  const roots = [];
  if (!Array.isArray(raw)) return roots;
  for (const item of raw) {
    const id = typeof item === "string" ? item : (item && typeof item.uid === "string" ? item.uid : "");
    if (id && !roots.includes(id)) roots.push(id);
  }
  return roots;
}

export function createHost({ api = globalThis.roamAlphaAPI, storage = globalThis.localStorage, graph } = {}) {
  const stats = { writes: 0, watches: 0, pageWatches: 0, renders: 0, items: {}, errors: 0 };
  bindGuardStats(stats);
  const data = api.data;
  // Every data.block.* call is its own Roam undo entry. The log groups the calls of one session transaction
  // (host.group) so one undo()/redo() steps over the whole user operation. A write outside a group is its own step.
  // A group holds at most MAX_GROUP_WRITES writes: a larger transaction is split into consecutive groups (one plexus
  // undo entry, so one Cmd+Z, per chunk) so every entry stays inside Roam's own undo depth and undo never has to
  // clean up with deletes (those would land on Roam's stack and resurrect blocks on the next Cmd+Z).
  const undoLog = [];
  const redoLog = [];
  const UNDO_LOG_MAX = 200;
  const MAX_GROUP_WRITES = 45; // under Roam's undo depth (50)
  const UNDO_ECHO_MS = 900; // Roam echoes our own writes back through the pull watch; those are not foreign edits
  let openGroup = null;
  let lastWriteAt = -Infinity;
  let dropBurst = () => {};
  // Debug only. The undo group that just closed, and how many create/update/move/delete writes it held.
  const closeChunk = (chunk) => {
    if (!(chunk.n || chunk.created?.length)) return;
    undoLog.push(chunk);
    if (undoLog.length > UNDO_LOG_MAX) undoLog.shift();
    const named = typeof chunk.label === "string" && chunk.label ? chunk.label : (chunk.kinds || []).join("+");
    stats.lastAction = { label: named, writes: chunk.n || 0 };
  };
  const noteWrite = (kind) => {
    dropBurst();
    lastWriteAt = Date.now();
    redoLog.length = 0;
    if (openGroup) {
      if (openGroup.n >= MAX_GROUP_WRITES) {
        const done = openGroup;
        openGroup = { n: 0, kinds: [], label: done.label || "" };
        closeChunk(done);
      }
      openGroup.n++;
      if (kind && !openGroup.kinds.includes(kind)) openGroup.kinds.push(kind);
      return;
    }
    closeChunk({ n: 1, kinds: kind ? [kind] : [] });
  };
  // Host writes plus blocks adopted from outside this host (one Roam entry each).
  const groupSpan = (entry) => (entry.n || 0) + (entry.created?.length || 0);
  const cache = createCardCache();
  const warm = new Set();
  const boardKeys = new Map();
  const boardPageOf = new Map();
  const pdfUrls = new Map();
  const boardCovers = new Map();
  const watchedBoards = new Map();
  const watchedBlocks = new Map();
  const eidByUid = new Map();
  const eidByTitle = new Map();
  const statsCache = new Map();
  const PRIME_CHUNK = 40;
  const STATS_TTL_MS = 120000;
  const MISS = Symbol("pull-miss");
  const rawPull = typeof data.pull === "function" ? data.pull.bind(data) : () => null;
  const parseEntity = (entity) => {
    if (Array.isArray(entity)) return { key: entity[0], value: entity[1] };
    const match = /^\[\s*(:[\w/.-]+)\s+"((?:[^"\\]|\\.)*)"\s*\]$/.exec(String(entity ?? ""));
    if (match) return { key: match[1], value: match[2].replace(/\\"/g, "\"").replace(/\\\\/g, "\\") };
    return null;
  };
  const stillUsed = (prefix, except) => {
    for (const [boardUid, keys] of boardKeys) {
      if (boardUid !== except && keys.has(prefix)) return true;
    }
    return false;
  };
  const forgetUid = (id) => {
    const uid = String(id ?? "");
    if (!uid) return;
    cache.forgetBlock(uid);
    warm.delete(uid);
    eidByUid.delete(uid);
  };
  // Index a board pull. `honored` means the pattern actually returned :block/refs, so page rows
  // and diagram attrs in this tree are complete. A narrow echo keeps the refs already stored.
  // Cached reads are trusted only while a mounted board's watch covers them.
  const BURST_MS = 150;
  const burstMemo = new Map();
  const readBurst = (key) => {
    const hit = burstMemo.get(key);
    if (!hit || Date.now() - hit.at >= BURST_MS) return MISS;
    return hit.value;
  };
  const writeBurst = (key, value) => {
    burstMemo.set(key, { value, at: Date.now() });
    if (burstMemo.size > 2000) burstMemo.clear();
  };
  dropBurst = () => burstMemo.clear(); // a write makes the 150 ms read memo stale
  const liveCached = (id) => {
    if (!id || !warm.has(id)) return null;
    const key = `b:${id}`;
    for (const [boardUid, keys] of boardKeys) {
      const slot = watchedBoards.get(boardUid);
      if (slot && slot.n > 0 && keys.has(key)) return cache.blockOf(id) || null;
    }
    return null;
  };
  const pageOfCoveringBoard = (id) => {
    const key = `b:${id}`;
    for (const [boardUid, keys] of boardKeys) {
      const slot = watchedBoards.get(boardUid);
      if (slot && slot.n > 0 && keys.has(key)) {
        const page = boardPageOf.get(boardUid);
        if (page) return page;
      }
    }
    return "";
  };
  const watchedPdfUrl = (pageUid) => {
    for (const [boardUid, slot] of watchedBoards) {
      if (!slot || slot.n <= 0) continue;
      const url = pdfUrls.get(`${boardUid}\0${pageUid}`);
      if (typeof url === "string") return url;
    }
    return MISS;
  };
  // Parent string from the open pull: :block/parents on the node, or the cached block that lists it as a child.
  const parentFromLive = (id, live) => {
    const parents = live[":block/parents"];
    const list = Array.isArray(parents) ? parents : (parents && typeof parents === "object" ? [parents] : []);
    for (const parent of list) {
      if (typeof parent?.[":block/string"] === "string") return parent[":block/string"];
    }
    const rev = live[":block/_children"];
    const first = Array.isArray(rev) ? rev[0] : rev;
    if (typeof first?.[":block/string"] === "string") return first[":block/string"];
    const key = `b:${id}`;
    for (const [boardUid, keys] of boardKeys) {
      const slot = watchedBoards.get(boardUid);
      if (!slot || slot.n <= 0 || !keys.has(key)) continue;
      const owned = [cache.blockOf(boardUid)];
      for (const other of keys) {
        if (other.startsWith("b:")) owned.push(cache.blockOf(other.slice(2)));
      }
      for (const owner of owned) {
        if (!owner || !childNodes(owner).some((child) => child?.[":block/uid"] === id)) continue;
        if (typeof owner[":block/string"] === "string") return owner[":block/string"];
      }
    }
    return MISS;
  };
  const absorb = (boardUid, node, honored) => {
    const prev = boardKeys.get(boardUid) || new Set();
    const next = new Set();
    const see = (key) => next.add(key);
    const pdfPrefix = `${boardUid}\0`;
    if (honored) {
      for (const key of pdfUrls.keys()) if (key.startsWith(pdfPrefix)) pdfUrls.delete(key);
    }
    const notePdf = (pageUid, url) => {
      if (typeof pageUid === "string" && pageUid && typeof url === "string") pdfUrls.set(pdfPrefix + pageUid, url);
    };
    const walk = (cur, asRef, isRoot) => {
      if (!cur || typeof cur !== "object") return;
      const id = typeof cur[":block/uid"] === "string" ? cur[":block/uid"] : "";
      const title = typeof cur[":node/title"] === "string" ? cur[":node/title"] : "";
      if (id) {
        cache.rememberBlock(id, cur);
        see(`b:${id}`);
        if (!isRoot) warm.add(id);
        if (asRef) cache.markRef(id, boardUid);
        if (honored) cache.markNative(id);
        notePdf(id, cur[":pdf/url"]);
      }
      const page = pageNodeOf(cur);
      if (page) notePdf(page[":block/uid"], page[":pdf/url"]);
      if (title && (asRef || isRoot)) {
        cache.rememberPage(title, cur);
        cache.notePageBoard(title, boardUid);
        see(`t:${title}`);
      }
      for (const ref of refNodes(cur)) walk(ref, true, false);
      for (const kid of childNodes(cur)) walk(kid, asRef, false);
    };
    walk(node, false, true);
    const inferred = inferBoardPage(node);
    if (inferred) boardPageOf.set(boardUid, inferred);
    else if (honored) boardPageOf.set(boardUid, "");
    if (!honored) {
      for (const key of prev) {
        if (key.startsWith("t:")) see(key);
        else if (key.startsWith("b:") && cache.isRef(key.slice(2))) see(key);
      }
    }
    for (const key of prev) {
      if (next.has(key)) continue;
      if (key.startsWith("b:")) {
        const id = key.slice(2);
        warm.delete(id);
        if (!stillUsed(key, boardUid)) cache.forgetBlock(id);
      } else if (key.startsWith("t:") && !stillUsed(key, boardUid)) {
        cache.forgetPage(key.slice(2));
      }
    }
    if (typeof node?.[":block/uid"] === "string") warm.delete(node[":block/uid"]);
    boardKeys.set(boardUid, next);
  };
  const addEntity = (boardUid, node) => {
    const keys = boardKeys.get(boardUid) || new Set();
    const walk = (cur) => {
      if (!cur || typeof cur !== "object") return;
      const id = typeof cur[":block/uid"] === "string" ? cur[":block/uid"] : "";
      const title = typeof cur[":node/title"] === "string" ? cur[":node/title"] : "";
      if (id) {
        cache.rememberBlock(id, cur);
        cache.markRef(id, boardUid);
        warm.add(id);
        keys.add(`b:${id}`);
      }
      if (title) {
        cache.rememberPage(title, cur);
        cache.notePageBoard(title, boardUid);
        keys.add(`t:${title}`);
      }
      for (const kid of childNodes(cur)) walk(kid);
    };
    walk(node);
    boardKeys.set(boardUid, keys);
  };
  const servePull = (pattern, entity) => {
    const parsed = parseEntity(entity);
    if (!parsed) return MISS;
    const text = String(pattern ?? "");
    const compact = text.replace(/\s+/g, "");
    let node = null;
    let id = "";
    if (parsed.key === ":node/title") {
      node = cache.pageOf(parsed.value);
      id = node?.[":block/uid"] || "";
    } else if (parsed.key === ":block/uid" || parsed.key === ":db/id") {
      if (parsed.key === ":db/id") return MISS;
      node = cache.blockOf(parsed.value);
      id = parsed.value;
    } else return MISS;
    if (!node) return MISS;
    if (compact.includes(":block/parents") && !node[":block/parents"]) return MISS;
    if (compact.includes(":block/_children") && !node[":block/_children"]) return MISS;
    if (compact.includes(":pdf/url") && node[":pdf/url"] == null) return MISS;
    if (compact === "[:db/id]" && node[":db/id"] == null) return MISS;
    if (compact === "[:block/open]" && !(":block/open" in node)) return MISS;
    if (compact.includes(":diagram/") && !cache.nativeKnown(id) && !node[":diagram/nodes"] && !node[":diagram/edges"]) return MISS;
    // A board-shaped node must not answer a pattern that asks for what the board pull never stored
    // (:edit/time, :create/time, :create/user, a page's :node/title, ...).
    if (!nodeAnswers(node, patternNeeds(text))) return MISS;
    return node;
  };
  // Plexus's own reads go through the cache. Roam's global pull is never replaced: other extensions
  // asked for their own pattern, and a cached node from Plexus's pattern would answer the wrong question.
  const pull = (pattern, entity) => {
    const hit = servePull(pattern, entity);
    if (hit !== MISS) return hit;
    return rawPull(pattern, entity);
  };
  const pullMany = (uids, titles) => {
    if (!uids.length && !titles.length) return [];
    if (typeof data.pull_many === "function") {
      const eids = [];
      for (const id of uids) eids.push([":block/uid", id]);
      for (const title of titles) eids.push([":node/title", title]);
      try {
        const many = data.pull_many(REF_BODY, eids);
        if (Array.isArray(many)) return many.filter((node) => node && typeof node === "object");
      } catch { /* one datalog pull covers the same ids */ }
    }
    try {
      if (uids.length && titles.length) {
        return unpackPulls(host.q(
          `[:find (pull ?e ${REF_BODY}) :in $ [?uid ...] [?title ...] :where (or [?e :block/uid ?uid] [?e :node/title ?title])]`,
          uids,
          titles,
        ));
      }
      if (uids.length) {
        return unpackPulls(host.q(
          `[:find (pull ?e ${REF_BODY}) :in $ [?uid ...] :where [?e :block/uid ?uid]]`,
          uids,
        ));
      }
      return unpackPulls(host.q(
        `[:find (pull ?e ${REF_BODY}) :in $ [?title ...] :where [?e :node/title ?title]]`,
        titles,
      ));
    } catch {
      return [];
    }
  };
  const fetchLinked = (titles) => {
    if (!titles.length) return;
    let rows = [];
    try {
      rows = host.q(LINKED_MANY, titles) || [];
    } catch {
      return;
    }
    const byTitle = new Map();
    for (const title of titles) byTitle.set(title, []);
    for (const row of rows) {
      const title = row?.[0];
      const id = row?.[1];
      if (!byTitle.has(title) || !id) continue;
      const list = byTitle.get(title);
      if (list.some((item) => item.uid === id) || list.length >= 40) continue;
      list.push({ uid: id, string: String(row?.[2] ?? ""), pageTitle: row?.[3] || "" });
    }
    for (const [title, list] of byTitle) cache.rememberLinked(`page:${title}`, list);
  };
  const dropStats = (boardUid) => {
    const prefix = `${boardUid || ""}\0`;
    for (const key of [...statsCache.keys()]) if (key.startsWith(prefix)) statsCache.delete(key);
  };
  const freshStat = (boardUid, key) => {
    const hit = statsCache.get(`${boardUid || ""}\0${key}`);
    if (!hit) return null;
    if (Date.now() - hit.at > STATS_TTL_MS) {
      statsCache.delete(`${boardUid || ""}\0${key}`);
      return null;
    }
    return hit.stats;
  };
  const notifyPages = (slot, after) => {
    for (const set of slot.pages.values()) for (const fn of set) fn(after);
  };
  let coverMemo = null;
  const readPdfCover = (url) => {
    const pages = [];
    for (const row of queryRows(host, PDF_PAGE_QUERY, url)) {
      if (!Array.isArray(row)) continue;
      const uid = row[0];
      const title = row[1];
      if (typeof uid !== "string" || uid === "") continue;
      pages.push({ uid, title: typeof title === "string" ? title : "", url });
    }
    const page = pdfPagePlan(url, pages);
    if (!page) return { ...coverModel({ url, count: 0 }), pageUid: null };
    let count = 0;
    for (const row of queryRows(host, PDF_PAGE_BLOCKS_QUERY, page.uid)) {
      const cells = Array.isArray(row) ? row : [row];
      if (cells.some(hasPdfHighlight)) count++;
    }
    return { ...coverModel({ title: page.title, url, count }), pageUid: page.uid };
  };
  const gname = graph ?? graphName();

  const host = {
    api,
    pull,
    // A fresh read, never the board cache: false only when Roam has no block with this uid.
    blockExists(uid) {
      if (typeof uid !== "string" || !uid) return false;
      try { return Boolean(rawPull("[:block/uid]", [":block/uid", uid])); } catch { return true; }
    },
    stats,
    viewports: createViewportStore({ storage, graph: gname }),
    tabs: createTabStore({ storage, graph: gname }),

    // One wide pull fills the session cache, so later card, page, and badge reads do not call Roam again.
    pullBoard(uid, { light = false } = {}) {
      if (warm.has(uid)) {
        const cached = cache.blockOf(uid);
        if (cached?.[":block/uid"]) return cached;
      }
      warm.delete(uid);
      const boardEntity = eidKey(uid);
      let node = null;
      try { node = rawPull(OPEN_PATTERN, boardEntity); } catch { node = null; }
      let honored = Boolean(node?.[":block/uid"] && hasRefs(node));
      if (!node?.[":block/uid"]) {
        try { node = rawPull(BOARD_PATTERN, boardEntity); } catch { node = null; }
        honored = false;
      }
      if (!node?.[":block/uid"]) return null;
      absorb(uid, node, honored);
      const found = collectTargets(node);
      if (!honored && (found.uids.length || found.titles.length)) {
        for (const entity of pullMany(found.uids, found.titles)) addEntity(uid, entity);
      }
      boardCovers.set(uid, honored);
      // A keep-alive catch-up is light: the board shows at once. Badge and linked-ref
      // reads run when the browser is idle.
      const prime = () => {
        try { fetchLinked(found.titles); } catch { /* a later linkedRefs ask reads Roam */ }
        dropStats(uid);
        if (found.stats.length) {
          try { host.cardStats(found.stats, { boardUid: uid }); } catch { /* badges ask again */ }
        }
      };
      if (!light) prime();
      else {
        // Linked refs stay in chunks of PRIME_CHUNK. Card stats are one pull:
        // 300 cards measured about 19 ms, inside one idle slice.
        const idle = globalThis.requestIdleCallback;
        const later = (fn) => (typeof idle === "function" ? idle(() => fn(), { timeout: 1500 }) : setTimeout(fn, 250));
        const titles = found.titles;
        const targets = found.stats;
        let ti = 0;
        let statsDone = false;
        const step = () => {
          if (ti === 0 && !statsDone) dropStats(uid);
          if (ti < titles.length) {
            try { fetchLinked(titles.slice(ti, ti + PRIME_CHUNK)); } catch { /* a later linkedRefs ask reads Roam */ }
            ti += PRIME_CHUNK;
          } else if (!statsDone) {
            statsDone = true;
            if (targets.length) {
              try { host.cardStats(targets, { boardUid: uid }); } catch { /* badges ask again */ }
            }
          }
          if (ti < titles.length || !statsDone) later(step);
        };
        later(step);
      }
      return node;
    },

    // Hover warm of the session cache. No pull watch. A uid already in blockOf is not read again:
    // pullBoard drops the board root from its warm set, and a hover must not spend that read.
    prefetchBoard(uid) {
      const id = String(uid ?? "");
      if (!id) return null;
      const cached = cache.blockOf(id);
      if (cached?.[":block/uid"]) return cached;
      return host.pullBoard(id);
    },

    // One unwatched read. Not added to the board pull watch.
    pullEntity(pattern, uid) {
      if (typeof pattern !== "string" || pattern === "" || !uid) return null;
      try {
        const res = pull(pattern, eidKey(uid));
        return res && typeof res === "object" ? res : null;
      } catch {
        return null;
      }
    },

    watchBoard(uid, cb) {
      const covers = boardCovers.get(uid) === true;
      const pattern = covers ? OPEN_PATTERN : BOARD_PATTERN;
      let slot = watchedBoards.get(uid);
      if (!slot) {
        slot = { coversRefs: covers, n: 0, pages: new Map() };
        watchedBoards.set(uid, slot);
      } else if (covers) slot.coversRefs = true;
      slot.n += 1;
      const entity = watchEntity(uid);
      const wrapped = guardCallback("watchBoard", (before, after) => {
        if (after?.[":block/uid"]) absorb(uid, after, hasRefs(after));
        cb(after);
        if (covers) notifyPages(slot, after);
      }, { stats });
      data.addPullWatch(pattern, entity, wrapped);
      stats.watches++;
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        data.removePullWatch(pattern, entity, wrapped);
        stats.watches--;
        slot.n = Math.max(0, slot.n - 1);
        if (slot.n === 0 && slot.pages.size === 0) watchedBoards.delete(uid);
      };
    },

    // True when this ref was joined into a board pull whose one watch still includes it.
    coversBlock(uid) {
      const id = String(uid ?? "");
      if (!cache.isRef(id)) return false;
      for (const boardUid of cache.refBoardsOf(id)) {
        const slot = watchedBoards.get(boardUid);
        if (slot && slot.n > 0 && slot.coversRefs) return true;
      }
      return false;
    },

    // One shared pull watch per source uid, released with the last caller. coversBlock does not
    // gate it: a board watch does not see an edit inside a joined ref, so the cached string stays old.
    // cb receives the pull. A new string is written onto the cached block so the next read is current.
    watchBlock(uid, cb) {
      const id = String(uid ?? "");
      if (!id || typeof cb !== "function") return () => {};
      cb = guardCallback("watchBlock", cb, { stats });
      let slot = watchedBlocks.get(id);
      if (!slot) {
        const entity = watchEntity(id);
        const subs = [];
        const wrapped = guardCallback("watchBlock", (_before, after) => {
          const next = after?.[":block/string"];
          if (typeof next === "string") {
            const node = cache.blockOf(id);
            if (node && typeof node === "object") node[":block/string"] = next;
            burstMemo.delete(id);
          }
          for (const token of subs.slice()) if (token.on) token.cb(after);
        }, { stats });
        slot = { entity, wrapped, subs };
        data.addPullWatch(BLOCK_WATCH_PATTERN, entity, wrapped);
        watchedBlocks.set(id, slot);
        stats.watches++;
      }
      const token = { cb, on: true };
      slot.subs.push(token);
      return () => {
        if (!token.on) return;
        token.on = false;
        const i = slot.subs.indexOf(token);
        if (i >= 0) slot.subs.splice(i, 1);
        if (slot.subs.length > 0 || watchedBlocks.get(id) !== slot) return;
        watchedBlocks.delete(id);
        data.removePullWatch(BLOCK_WATCH_PATTERN, slot.entity, slot.wrapped);
        stats.watches--;
      };
    },

    pullNative(uid) {
      return pull(NATIVE_PATTERN, eidKey(uid)) ?? null;
    },

    pullProps(uid) {
      const res = pull("[:block/props]", eidKey(uid));
      const props = res?.[":block/props"];
      return props && typeof props === "object" ? plainKeys(props) : {};
    },

    pullTree(uid, depth = 2, limit = 12) {
      const id = String(uid ?? "");
      const live = liveCached(id);
      if (live && ":block/children" in live) return trimTree(live, depth, { left: limit });
      const burstKey = `tr:${id}\0${depth}\0${limit}`;
      const burst = readBurst(burstKey);
      if (burst !== MISS) return burst;
      const res = rawPull(BOARD_PATTERN, eidKey(uid));
      const value = res ? trimTree(res, depth, { left: limit }) : [];
      writeBurst(burstKey, value);
      return value;
    },

    pullPage(title) {
      const res = pull(BOARD_PATTERN, [":node/title", title]);
      return res && res[":block/uid"] ? res : null;
    },

    pagePreview(title, depth = 2, limit = 12) {
      const res = pull(BOARD_PATTERN, [":node/title", title]);
      if (!res || !res[":block/uid"]) return { uid: null, exists: false, blocks: [] };
      return { uid: res[":block/uid"], exists: true, blocks: trimTree(res, depth, { left: limit }) };
    },

    // The whole outline of a page for a page card: every level, folded blocks flagged `open: false`.
    pageOutline(title, limit = 400) {
      const res = pull(BOARD_PATTERN, [":node/title", title]);
      if (!res || !res[":block/uid"]) return { uid: null, exists: false, blocks: [] };
      return { uid: res[":block/uid"], exists: true, blocks: trimTree(res, 64, { left: limit }) };
    },

    // One pull watch on a page, for a page card on screen. The caller releases it.
    // A page already inside an open board shares that board's watch instead of adding another.
    watchPage(title, cb) {
      const name = String(title ?? "");
      cb = guardCallback("watchPage", cb, { stats });
      for (const boardUid of cache.pageBoardsOf(name)) {
        const slot = watchedBoards.get(boardUid);
        if (!slot || slot.n <= 0 || !slot.coversRefs) continue;
        let set = slot.pages.get(name);
        if (!set) {
          set = new Set();
          slot.pages.set(name, set);
        }
        const wrapped = (after) => cb(after);
        set.add(wrapped);
        stats.pageWatches++;
        let active = true;
        return () => {
          if (!active) return;
          active = false;
          set.delete(wrapped);
          if (set.size === 0) slot.pages.delete(name);
          stats.pageWatches--;
          if (slot.n === 0 && slot.pages.size === 0) watchedBoards.delete(boardUid);
        };
      }
      const entity = `[:node/title ${JSON.stringify(name)}]`;
      const wrapped = (before, after) => cb(after);
      data.addPullWatch(BOARD_PATTERN, entity, wrapped);
      stats.pageWatches++;
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        data.removePullWatch(BOARD_PATTERN, entity, wrapped);
        stats.pageWatches--;
      };
    },

    pageUid(title) {
      const res = pull("[:block/uid]", [":node/title", title]);
      return res?.[":block/uid"] ?? null;
    },

    // Top-level blocks of one daily page. A missing page is an empty day. This never creates the page.
    dailyBlocks(when) {
      const title = dailyTitle(when);
      const expectUid = dailyUid(when);
      const pattern = "[:block/uid :node/title {:block/children [:block/uid :block/string :block/order]}]";
      let res = null;
      try { res = pull(pattern, [":node/title", title]); } catch { res = null; }
      if (!res?.[":block/uid"]) {
        try { res = pull(pattern, eidKey(expectUid)); } catch { res = null; }
      }
      const exists = Boolean(res?.[":block/uid"]);
      return {
        title,
        uid: exists ? String(res[":block/uid"]) : expectUid,
        exists,
        rows: journalRows(exists ? res : null),
      };
    },

    // The templates page is created once. A second call returns the existing uid.
    async ensurePage(title) {
      const name = String(title ?? "").trim();
      if (!name) return null;
      const existing = host.pageUid(name);
      if (existing) return existing;
      stats.writes++;
      await data.page.create({ page: { title: name } });
      noteWrite("create");
      return host.pageUid(name);
    },

    // Blocks that link to the page. The card's own [[title]] counts as one.
    pageRefCount(title) {
      const name = String(title ?? "");
      if (!name) return 0;
      let rows;
      try {
        rows = host.q("[:find (count ?b) :in $ ?t :where [?p :node/title ?t] [?b :block/refs ?p]]", name);
      } catch { return 0; }
      const n = Array.isArray(rows) ? rows[0]?.[0] : 0;
      const count = Number(n);
      return Number.isFinite(count) ? count : 0;
    },

    // One Roam undo step. Roam rewrites every [[old]] reference, including the card.
    // page.update takes the uid and the new title on the same page object.
    async renamePage(from, to) {
      const oldTitle = String(from ?? "").trim();
      const newTitle = String(to ?? "").trim();
      if (!oldTitle || !newTitle || oldTitle === newTitle) return false;
      const uid = host.pageUid(oldTitle);
      if (!uid) return false;
      stats.writes++;
      await data.page.update({ page: { uid, title: newTitle } });
      noteWrite("update");
      return true;
    },

    cardStringForUid(uid) {
      const id = String(uid ?? "").trim();
      if (!id) return null;
      let res;
      try { res = pull("[:block/uid :node/title]", eidKey(id)); } catch { return null; }
      if (!res?.[":block/uid"]) return null;
      const title = res[":node/title"];
      return typeof title === "string" && title ? `[[${title}]]` : `((${id}))`;
    },

    // A block inside a watched board reads from the session cache (the watch keeps it fresh).
    // Anything else is memoised for one paint burst, so a repaint does not pull the same block 10 times.
    blockString(uid) {
      const id = String(uid ?? "");
      const live = liveCached(id);
      if (live && typeof live[":block/string"] === "string") return live[":block/string"];
      const hit = readBurst(id);
      if (hit !== MISS) return hit;
      const res = pull("[:block/string]", eidKey(uid));
      const value = typeof res?.[":block/string"] === "string" ? res[":block/string"] : null;
      writeBurst(id, value);
      return value;
    },

    // Strings for many uids in one query: element-id parsing tries every "-" split of an id.
    // fresh: skip the session cache and the burst memo, and write what Roam returns back into the cache.
    // A ref target is joined into the board pull, but the board watch does not fire when it changes.
    blockStrings(uids, { fresh = false } = {}) {
      const out = new Map();
      const now = Date.now();
      const missing = [];
      for (const uid of uids || []) {
        const id = String(uid ?? "");
        if (!id || out.has(id)) continue;
        if (fresh) { missing.push(id); out.set(id, null); continue; }
        const live = liveCached(id);
        if (live && typeof live[":block/string"] === "string") { out.set(id, live[":block/string"]); continue; }
        const hit = burstMemo.get(id);
        if (hit && now - hit.at < BURST_MS) { out.set(id, hit.value); continue; }
        missing.push(id);
      }
      if (!missing.length) return out;
      let rows = [];
      try {
        const q = data.fast?.q ? data.fast.q.bind(data.fast) : data.q?.bind(data);
        rows = q ? q("[:find ?u ?s :in $ [?u ...] :where [?b :block/uid ?u] [?b :block/string ?s]]", missing) || [] : [];
      } catch { rows = []; }
      const found = new Map();
      for (const row of rows) if (Array.isArray(row) && typeof row[0] === "string") found.set(row[0], typeof row[1] === "string" ? row[1] : null);
      for (const id of missing) {
        const value = found.has(id) ? found.get(id) : null;
        out.set(id, value);
        burstMemo.set(id, { value, at: now });
        if (fresh && typeof value === "string") {
          const node = cache.blockOf(id);
          if (node && typeof node === "object") node[":block/string"] = value;
        }
      }
      if (burstMemo.size > 2000) burstMemo.clear();
      return out;
    },

    // Page uid that owns a block. Empty when the block is missing or is itself a page.
    // A warm descendant without its own :block/page shares the watched board's page.
    blockPageUid(uid) {
      const id = String(uid ?? "");
      const live = liveCached(id);
      if (live) {
        if (":block/page" in live) {
          const own = pageNodeOf(live)?.[":block/uid"];
          if (typeof own === "string" && own) return own;
        } else if (!cache.isRef(id)) {
          const boardPage = pageOfCoveringBoard(id);
          if (boardPage) return boardPage;
        }
      }
      const burst = readBurst(`pg:${id}`);
      if (burst !== MISS) return burst;
      let value = "";
      try {
        const res = rawPull("[{:block/page [:block/uid]}]", eidKey(uid));
        const own = pageNodeOf(res)?.[":block/uid"];
        value = typeof own === "string" ? own : "";
      } catch { value = ""; }
      writeBurst(`pg:${id}`, value);
      return value;
    },

    // Page that owns a block. Empty when the block is missing or is itself a page.
    pageTitleOf(uid) {
      const res = pull("[{:block/page [:node/title]}]", eidKey(uid));
      const page = res?.[":block/page"];
      const node = Array.isArray(page) ? page[0] : page;
      const title = node?.[":node/title"];
      return typeof title === "string" ? title : "";
    },

    // Highlight read: props, string, and the owning page title. No url query.
    blockProps(uid) {
      let res = null;
      try { res = pull(BLOCK_PROPS_PATTERN, eidKey(uid)); } catch { return null; }
      if (!res || typeof res !== "object" || Array.isArray(res)) return null;
      const page = res[":block/page"];
      const node = Array.isArray(page) ? page[0] : page;
      const title = node?.[":node/title"];
      const props = res[":block/props"];
      const string = res[":block/string"];
      return {
        props: props && typeof props === "object" && !Array.isArray(props) ? props : {},
        string: typeof string === "string" ? string : "",
        pageTitle: typeof title === "string" ? title : "",
      };
    },

    // Bytes for a graph file. Encrypted graphs only decrypt through file.get; the URL itself taints a canvas.
    async getFile(url) {
      const get = api.file?.get;
      if (typeof get !== "function") return null;
      const src = String(url ?? "").trim();
      if (!src) return null;
      try {
        return await get.call(api.file, { url: src });
      } catch {
        return null;
      }
    },

    parentString(uid) {
      const id = String(uid ?? "");
      const live = liveCached(id);
      if (live) {
        const found = parentFromLive(id, live);
        if (found !== MISS) return found;
      }
      const burst = readBurst(`ps:${id}`);
      if (burst !== MISS) return burst;
      const res = rawPull("[{:block/_children [:block/string]}]", eidKey(uid));
      const p = res?.[":block/_children"];
      const first = Array.isArray(p) ? p[0] : p;
      const value = typeof first?.[":block/string"] === "string" ? first[":block/string"] : null;
      writeBurst(`ps:${id}`, value);
      return value;
    },

    resolveEid(ref) {
      const entity = ref?.uid ? eidKey(ref.uid) : ref?.title ? [":node/title", ref.title] : null;
      if (!entity) return null;
      if (ref?.uid && eidByUid.has(ref.uid)) return eidByUid.get(ref.uid);
      if (ref?.title && eidByTitle.has(ref.title)) return eidByTitle.get(ref.title);
      const res = pull("[:db/id]", entity);
      const id = res?.[":db/id"] ?? null;
      if (id != null) {
        if (ref?.uid) eidByUid.set(ref.uid, id);
        if (ref?.title) eidByTitle.set(ref.title, id);
      }
      return id;
    },

    generateUid() { return api.util.generateUID(); },

    async createBlock({ parentUid, order = "last", uid, string = "", props, open, viewType } = {}) {
      const id = uid ?? api.util.generateUID();
      const block = { uid: id, string };
      if (props !== undefined) block.props = plainKeys(props);
      if (open !== undefined) block.open = open;
      if (viewType) block["children-view-type"] = viewType;
      stats.writes++;
      await data.block.create({ location: { "parent-uid": parentUid, order }, block });
      noteWrite("create");
      return id;
    },

    // One Roam undo for the whole tree. Roots are recorded with span 0 so groupSpan
    // does not add another data.undo per root (that would pop the siblings after the tree).
    async fromMarkdown({ parentUid, order = "last", markdown } = {}) {
      const parent = String(parentUid ?? "");
      if (!parent) return [];
      const fn = data.block?.fromMarkdown;
      if (typeof fn !== "function") throw new Error("fromMarkdown is missing");
      const result = await fn({
        location: { "parent-uid": parent, order },
        "markdown-string": String(markdown ?? ""),
      });
      const roots = markdownRootUids(result);
      stats.writes++;
      noteWrite("create");
      for (const id of roots) host.adoptCreated(id, { span: 0 });
      return roots;
    },

    canCreateGridTable() { return Boolean(roamGridV1()); },

    // null when Roam Grid is absent or lacks createTableFromModel. writes is the
    // number of Roam undo entries counted (returnInfo.writes plus GRID_METADATA_UNDOS
    // when enhance is on). The table uid is adopted with span 0; noteWrite owns the span.
    async createGridTable(spec) {
      const v1 = roamGridV1();
      if (!v1) return null;
      const args = gridModelArgs(spec);
      const info = await v1.createTableFromModel(args);
      const uid = typeof info?.uid === "string" ? info.uid : "";
      if (!uid) return null;
      const reported = Number.isInteger(info.writes) && info.writes > 0 ? info.writes : 1;
      const meta = args.enhance === false ? 0 : GRID_METADATA_UNDOS;
      const undos = reported + meta;
      for (let i = 0; i < undos; i += 1) {
        stats.writes++;
        noteWrite(i === 0 ? "create" : "update");
      }
      host.adoptCreated(uid, { span: 0 });
      const extra = Array.isArray(info.uids) ? info.uids : [];
      for (const id of extra) if (typeof id === "string" && id && id !== uid) host.adoptCreated(id, { span: 0 });
      const path = info.path === "sequential" ? "sequential" : "markdown";
      return { uid, writes: undos, path };
    },

    // Footnotes already on a page: the top-level header block (exact text) with its note count,
    // the highest (N) alias label anywhere on the page, and whether a "---" rule sits just above
    // the header. null when the page cannot be read.
    footnoteState(pageUid, header = "#footnotes") {
      const id = String(pageUid ?? "");
      if (!id) return null;
      let res = null;
      try { res = rawPull("[:block/uid {:block/children ...} :block/string :block/order]", eidKey(id)); } catch { return null; }
      if (!res || typeof res !== "object") return null;
      const top = Array.isArray(res[":block/children"]) ? [...res[":block/children"]] : [];
      top.sort((a, b) => (a[":block/order"] ?? 0) - (b[":block/order"] ?? 0));
      const strOf = (b) => (typeof b?.[":block/string"] === "string" ? b[":block/string"] : "");
      const kids = (b) => (Array.isArray(b?.[":block/children"]) ? b[":block/children"] : []);
      let max = 0;
      const re = /\[\((\d+)\)\]\(\(\([^)]*\)\)\)/g;
      const walk = (b) => {
        re.lastIndex = 0;
        let m;
        const text = strOf(b);
        while ((m = re.exec(text))) max = Math.max(max, Number(m[1]) || 0);
        for (const k of kids(b)) walk(k);
      };
      for (const b of top) walk(b);
      const at = top.findIndex((b) => strOf(b).trim() === header);
      const node = at >= 0 ? top[at] : null;
      return {
        headerUid: node && typeof node[":block/uid"] === "string" ? node[":block/uid"] : null,
        count: node ? kids(node).length : 0,
        max,
        hasLine: at > 0 && strOf(top[at - 1]).trim() === "---",
      };
    },

    // { parentUid, order } for a block, or null when Roam has no integer order.
    blockLocation(uid) {
      const id = String(uid ?? "");
      if (!id) return null;
      let res = null;
      try { res = rawPull("[:block/uid :block/order {:block/_children [:block/uid]}]", eidKey(id)); } catch { return null; }
      const order = res?.[":block/order"];
      const parents = res?.[":block/_children"];
      const parent = Array.isArray(parents) ? parents[0] : parents;
      const parentUid = typeof parent?.[":block/uid"] === "string" ? parent[":block/uid"] : "";
      if (!parentUid || !Number.isInteger(order)) return null;
      return { parentUid, order };
    },

    async updateString(uid, string) {
      stats.writes++;
      await data.block.update({ block: { uid, string } });
      noteWrite("update");
      forgetUid(uid);
    },

    async updateProps(uid, plexus) {
      forgetUid(uid);
      const merged = mergePropsForWrite(host.pullProps(uid), plexus);
      stats.writes++;
      await data.block.update({ block: { uid, props: merged } });
      noteWrite("update");
    },

    async moveBlock(uid, parentUid, order = "last") {
      stats.writes++;
      await data.block.move({ location: { "parent-uid": parentUid, order }, block: { uid } });
      noteWrite("move");
      forgetUid(uid);
    },

    async deleteBlock(uid) {
      stats.writes++;
      await data.block.delete({ block: { uid } });
      noteWrite("delete");
      forgetUid(uid);
    },

    async setOpen(uid, open) {
      stats.writes++;
      await data.block.update({ block: { uid, open } });
      noteWrite("update");
      forgetUid(uid);
    },

    // Runs fn (a serialized write sequence) as one undo step. Groups do not nest; the write queue serializes callers.
    // An optional label names the group in stats.lastAction. Otherwise the label is the write kinds in that group.
    async group(fn, label) {
      if (openGroup) return fn();
      openGroup = { n: 0, kinds: [], label: typeof label === "string" ? label : "" };
      try {
        return await fn();
      } finally {
        const g = openGroup; // the last chunk when the transaction rolled over
        openGroup = null;
        closeChunk(g);
      }
    },

    // A block another extension created inside the open group (Roam Plexus "New drawing").
    // That write never passed through noteWrite, so it is one extra Roam undo entry.
    // Recording the uid makes this group's undo/redo step over it too. No-op with no group open.
    // A delete here would land on Roam's stack and come back on the next redo.
    // span 0 records a fromMarkdown / Roam Grid root whose undo is already inside noteWrite
    // (one data.undo removes the whole tree). Those uids must not add to groupSpan.
    adoptCreated(uid, opts) {
      const id = typeof uid === "string" ? uid : "";
      if (!openGroup || !id) return;
      const key = opts && opts.span === 0 ? "markdownRoots" : "created";
      const list = openGroup[key] || (openGroup[key] = []);
      if (!list.includes(id)) list.push(id);
      redoLog.length = 0; // a new write drops Roam's redo stack; keep the log in step
    },

    // Undo/redo step over a whole recorded group; with nothing recorded (or after invalidateUndo) it is Roam's single step.
    async undo() {
      lastWriteAt = Date.now();
      const entry = undoLog.pop();
      const span = entry ? groupSpan(entry) : 1;
      let done = 0;
      try {
        for (; done < span; done++) await data.undo();
      } finally {
        lastWriteAt = Date.now();
        if (entry) {
          if (done >= span) redoLog.push(entry);
          else {
            if (done > 0) redoLog.push({ n: done });
            undoLog.push({ n: span - done }); // a failed step leaves the rest of the group undoable
          }
        }
      }
    },
    async redo() {
      lastWriteAt = Date.now();
      const entry = redoLog.pop();
      const span = entry ? groupSpan(entry) : 1;
      let done = 0;
      try {
        for (; done < span; done++) await data.redo();
      } finally {
        lastWriteAt = Date.now();
        if (entry) {
          if (done > 0) undoLog.push(done >= span ? entry : { n: done });
          if (done < span) redoLog.push({ n: span - done });
        }
      }
    },
    // Something else (a typed edit, another tool) touched the graph: the log no longer maps 1:1 onto Roam's stack.
    invalidateUndo() {
      if (openGroup || Date.now() - lastWriteAt < UNDO_ECHO_MS) return;
      undoLog.length = 0;
      redoLog.length = 0;
    },

    openInSidebar(uid, type = "block") {
      return api.ui.rightSidebar.addWindow({ window: { type, "block-uid": uid } });
    },
    openBlock(uid) { return api.ui.mainWindow.openBlock({ block: { uid } }); },
    openPage(uid) { return api.ui.mainWindow.openPage({ page: { uid } }); },

    renderString(el, string) { stats.renders++; return api.ui.components.renderString({ el, string }); },
    renderBlock(el, uid, { open = true } = {}) { stats.renders++; return api.ui.components.renderBlock({ uid, el, "open?": open }); },
    renderPage(el, uid, opts) {
      stats.renders++;
      const props = { uid, el };
      if (opts && typeof opts === "object") {
        for (const key of Object.keys(opts)) if (key !== "uid" && key !== "el") props[key] = opts[key];
      }
      return api.ui.components.renderPage(props);
    },
    unmount(el) { return api.ui.components.unmountNode({ el }); },

    q(query, ...inputs) {
      return data.fast?.q ? data.fast.q(query, ...inputs) : data.q(query, ...inputs);
    },

    // Page children for the highlight picker, four levels. No url query.
    pdfHighlightTree(pageUid) {
      const uid = typeof pageUid === "string" ? pageUid : "";
      if (!uid) return [];
      let res = null;
      try { res = pull(HIGHLIGHT_TREE_PATTERN, eidKey(uid)); } catch { return []; }
      if (!res || typeof res !== "object" || Array.isArray(res) || typeof res[":block/uid"] !== "string") return [];
      return highlightTreeNodes(res);
    },

    // Page attribute only. No block query and no file fetch.
    // A watched board's pull already carries :pdf/url for ref pages.
    pdfPageUrl(pageUid) {
      const uid = typeof pageUid === "string" ? pageUid : "";
      if (!uid) return "";
      const live = liveCached(uid);
      if (live && typeof live[":pdf/url"] === "string") return live[":pdf/url"];
      const watched = watchedPdfUrl(uid);
      if (watched !== MISS) return watched;
      const burst = readBurst(`url:${uid}`);
      if (burst !== MISS) return burst;
      let value = "";
      try {
        const res = rawPull("[:pdf/url]", eidKey(uid));
        const url = res?.[":pdf/url"];
        value = typeof url === "string" ? url : "";
      } catch { value = ""; }
      writeBurst(`url:${uid}`, value);
      return value;
    },

    // Read-only cover. :pdf/url is a page attribute. Highlight blocks sit anywhere on that page.
    pdfCover(string) {
      const url = pdfMacroUrl(string);
      if (!url) return { ...coverModel({ count: 0 }), pageUid: null };
      // A card paint asks twice and the picker once more; one turn shares one read, the next turn reads again.
      if (!coverMemo) {
        coverMemo = new Map();
        queueMicrotask(() => { coverMemo = null; });
      }
      const memo = coverMemo.get(url);
      if (memo) return { ...memo };
      const cover = readPdfCover(url);
      coverMemo?.set(url, cover);
      return { ...cover };
    },

    // The pdf macro block, scoped to the :pdf/url page's refs. No file fetch.
    pdfBlockByUrl(url) {
      if (typeof url !== "string") return "";
      const needle = url.trim();
      if (!needle || /[\r\n]/.test(url)) return "";
      const pageUid = readPdfCover(needle)?.pageUid;
      if (typeof pageUid !== "string" || pageUid === "") return "";
      const take = (query) => {
        for (const row of queryRows(host, query, pageUid, needle)) {
          const cell = Array.isArray(row) ? row[0] : row;
          if (typeof cell === "string" && cell && cell !== pageUid) return cell;
        }
        return "";
      };
      return take(PDF_BLOCK_OUT_QUERY) || take(PDF_BLOCK_IN_QUERY);
    },

    // Boards library: every enhanced (plexus.v === 2) board block in the graph. Read-only.
    listBoards({ limit = 200 } = {}) {
      const rows = host.q(
        `[:find ?u ?s ?pt ?pu :in $ ?pat :where [?b :block/string ?s] [(re-pattern ?pat) ?re] [(re-find ?re ?s)]
 [?b :block/uid ?u] [?b :block/page ?p] [?p :node/title ?pt] [?p :block/uid ?pu]]`,
        DIAGRAM_RE,
      ) || [];
      const out = [];
      for (const [uid, string, pageTitle, pageUid] of rows) {
        let res;
        try { res = pull(BOARD_META_PATTERN, eidKey(uid)); } catch { continue; }
        const props = res?.[":block/props"];
        if (!props || typeof props !== "object" || plainKeys(props)?.plexus?.v !== 2) continue;
        const kids = Array.isArray(res[":block/children"]) ? res[":block/children"] : [];
        const count = kids.filter((k) => {
          const kp = k?.[":block/props"];
          const type = kp && typeof kp === "object" ? plainKeys(kp)?.plexus?.type : "";
          return type !== "edges" && type !== "snapshots" && type !== "regions";
        }).length;
        const edited = res[":edit/time"];
        out.push({
          uid,
          title: parseBoardTitle(string) || "Untitled board",
          pageTitle,
          pageUid,
          count,
          edited: Number.isFinite(edited) ? edited : null,
        });
      }
      out.sort((a, b) => String(a.pageTitle).localeCompare(String(b.pageTitle)) || a.title.localeCompare(b.title));
      return out.slice(0, limit);
    },

    // RF-3: every connection block in the graph as [edgeUid, boardUid]: the children of a board's "Connections"
    // container. One read-only query; the chip layer keeps the result as a uid set.
    listConnectionBlocks({ limit = 5000 } = {}) {
      const rows = host.q(
        `[:find ?eu ?bu :in $ ?pat :where [?c :block/string "Connections"] [?b :block/children ?c] [?b :block/string ?s]
 [(re-pattern ?pat) ?re] [(re-find ?re ?s)] [?b :block/uid ?bu] [?c :block/children ?e] [?e :block/uid ?eu]]`,
        DIAGRAM_RE,
      ) || [];
      return rows.slice(0, limit).map(([edgeUid, boardUid]) => [edgeUid, boardUid]);
    },

    // The same connection blocks, plus the edge string and the board title, so an endpoint chip
    // can name the block the arrow lands on without a second query.
    listConnectionRefs({ limit = 5000 } = {}) {
      const rows = host.q(
        `[:find ?eu ?bu ?es ?bs :in $ ?pat :where [?c :block/string "Connections"] [?b :block/children ?c] [?b :block/string ?bs]
 [(re-pattern ?pat) ?re] [(re-find ?re ?bs)] [?b :block/uid ?bu] [?c :block/children ?e] [?e :block/uid ?eu] [?e :block/string ?es]]`,
        DIAGRAM_RE,
      ) || [];
      return rows.slice(0, limit).map(([edgeUid, boardUid, edgeString, boardString]) => [
        edgeUid,
        boardUid,
        typeof edgeString === "string" ? edgeString : "",
        parseBoardTitle(boardString) || "Untitled board",
      ]);
    },

    // Card footer stats. One reverse-attribute pull for the resolved targets.
    // The four collection-bound queries run only when that pull throws or is unusable.
    cardStats(targets, { boardUid } = {}) {
      const keys = [];
      for (const t of targets || []) {
        if (!t) continue;
        const ref = t.kind === "page" ? (t.title ? { title: t.title } : null) : t.uid ? { uid: t.uid } : null;
        if (!ref) continue;
        const key = t.kind === "page" ? `page:${t.title}` : `uid:${t.uid}`;
        if (!keys.includes(key)) keys.push(key);
      }
      if (keys.length && keys.every((key) => freshStat(boardUid, key))) {
        const result = new Map();
        for (const key of keys) result.set(key, { ...freshStat(boardUid, key) });
        return result;
      }
      const remember = (result) => {
        const at = Date.now();
        for (const [key, stat] of result) statsCache.set(`${boardUid || ""}\0${key}`, { at, stats: stat });
        return result;
      };
      const result = new Map();
      const byEid = new Map();
      for (const t of targets || []) {
        if (!t) continue;
        const ref = t.kind === "page" ? (t.title ? { title: t.title } : null) : t.uid ? { uid: t.uid } : null;
        if (!ref) continue;
        const key = t.kind === "page" ? `page:${t.title}` : `uid:${t.uid}`;
        if (result.has(key)) continue;
        result.set(key, { refs: 0, boards: 0, open: 0, done: 0 });
        const eid = host.resolveEid(ref);
        if (eid == null) continue;
        if (!byEid.has(eid)) byEid.set(eid, []);
        byEid.get(eid).push(key);
      }
      if (!byEid.size) return remember(result);
      const eids = [...byEid.keys()];
      const boardEid = boardUid ? host.resolveEid({ uid: boardUid }) ?? -1 : -1;
      const todoEid = host.resolveEid({ title: "TODO" });
      const doneEid = host.resolveEid({ title: "DONE" });
      const tally = (rows, field) => {
        const seen = new Map();
        for (const [t, x] of rows || []) {
          if (!seen.has(t)) seen.set(t, new Set());
          seen.get(t).add(x);
        }
        for (const [t, set] of seen) for (const key of byEid.get(t) ?? []) result.get(key)[field] = set.size;
      };
      const fromQueries = () => {
        tally(host.q(
          `[:find ?t ?b :in $ [?t ...] ?board :where [?b :block/refs ?t] (not [?b :block/parents ?board]) [(not= ?b ?board)]]`,
          eids, boardEid,
        ), "refs");
        tally(host.q(
          `[:find ?t ?d :in $ [?t ...] ?board ?pat :where [?b :block/refs ?t] [?b :block/parents ?d] [?d :block/string ?s]
 [(re-pattern ?pat) ?re] [(re-find ?re ?s)] [(not= ?d ?board)]]`,
          eids, boardEid, DIAGRAM_RE,
        ), "boards");
        const listFor = (statusEid) => host.q(
          `[:find ?t ?x :in $ [?t ...] ?status :where [?x :block/refs ?status] (or [?x :block/parents ?t] [?x :block/page ?t])]`,
          eids, statusEid,
        );
        if (todoEid != null) tally(listFor(todoEid), "open");
        if (doneEid != null) tally(listFor(doneEid), "done");
      };
      const applyPulled = (node, keyList) => {
        const refs = new Set();
        const boards = new Set();
        const openIds = new Set();
        const doneIds = new Set();
        if (node && typeof node === "object") {
          for (const block of listOf(node[":block/_refs"])) {
            const bid = refEid(block);
            if (bid == null) continue;
            const parents = listOf(block?.[":block/parents"]);
            const underBoard = bid === boardEid || parents.some((parent) => refEid(parent) === boardEid);
            if (!underBoard) refs.add(bid);
            for (const parent of parents) {
              const pid = refEid(parent);
              if (pid == null || pid === boardEid || !isDiagramBlock(parent)) continue;
              boards.add(pid);
            }
          }
          const seeStatus = (block) => {
            const xid = refEid(block);
            if (xid == null) return;
            let hasTodo = false;
            let hasDone = false;
            for (const ref of listOf(block?.[":block/refs"])) {
              const id = refEid(ref);
              if (id == null) continue;
              if (todoEid != null && id === todoEid) hasTodo = true;
              if (doneEid != null && id === doneEid) hasDone = true;
            }
            if (hasTodo) openIds.add(xid);
            if (hasDone) doneIds.add(xid);
          };
          for (const block of listOf(node[":block/_parents"])) seeStatus(block);
          for (const block of listOf(node[":block/_page"])) seeStatus(block);
        }
        for (const key of keyList) {
          const stat = result.get(key);
          stat.refs = refs.size;
          stat.boards = boards.size;
          stat.open = openIds.size;
          stat.done = doneIds.size;
        }
      };
      const fromPull = () => {
        let nodes = null;
        if (typeof data.pull_many === "function") {
          try { nodes = pullRows(data.pull_many(STATS_PULL, eids)); } catch { return false; }
          if (!nodes) return false;
        } else if (typeof data.pull === "function") {
          nodes = [];
          try {
            for (const eid of eids) {
              const one = data.pull(STATS_PULL, eid);
              nodes.push(one && typeof one === "object" ? one : null);
            }
          } catch { return false; }
        } else return false;
        const byId = new Map();
        nodes.forEach((node, i) => {
          const id = refEid(node);
          byId.set(id != null ? id : eids[i], node);
        });
        for (const [eid, keyList] of byEid) applyPulled(byId.get(eid), keyList);
        return true;
      };
      if (!fromPull()) fromQueries();
      return remember(result);
    },

    async uploadFile(file) {
      const upload = api.file?.upload;
      if (typeof upload !== "function") throw new Error("upload-unavailable");
      const res = await upload.call(api.file, { file });
      const raw = typeof res === "string" ? res : res?.url;
      // Roam's file.upload resolves to a ready-made markdown image (`![](url)`); callers want the bare URL.
      const md = typeof raw === "string" ? /^\s*!\[[^\]]*\]\((.+)\)\s*$/s.exec(raw) : null;
      const url = md ? md[1] : raw;
      if (typeof url !== "string" || !url) throw new Error("upload-failed");
      stats.writes++;
      return url;
    },

    searchPages(text, limit = 40) {
      const needle = String(text ?? "").toLowerCase();
      if (!needle) return [];
      // Roam's Datascript has no clojure.string/lower-case; cljs re-pattern turns a leading (?i) into the JS flag.
      const rows = host.q(
        `[:find ?t ?u :in $ ?pat :where [?p :node/title ?t] [(re-pattern ?pat) ?re] [(re-find ?re ?t)] [?p :block/uid ?u]]`,
        ciPattern(needle),
      ) || [];
      return rows
        .filter(([t]) => typeof t === "string" && !t.startsWith("roam/"))
        .map(([t, u]) => ({ uid: u, title: t }))
        .sort((a, b) => {
          const ap = a.title.toLowerCase().startsWith(needle) ? 0 : 1;
          const bp = b.title.toLowerCase().startsWith(needle) ? 0 : 1;
          return ap - bp || a.title.length - b.title.length || a.title.localeCompare(b.title);
        })
        .slice(0, limit);
    },

    searchBlocks(text, limit = 40) {
      const needle = String(text ?? "").toLowerCase();
      if (!needle) return [];
      const rows = host.q(
        `[:find ?s ?u ?t :in $ ?pat :where [?b :block/string ?s] [(re-pattern ?pat) ?re] [(re-find ?re ?s)]
 [?b :block/uid ?u] [?b :block/page ?p] [?p :node/title ?t]]`,
        ciPattern(needle),
      ) || [];
      return rows
        .filter(([, , t]) => typeof t === "string" && !t.startsWith("roam/"))
        .slice(0, limit)
        .map(([s, u, t]) => ({ uid: u, string: s, pageTitle: t }));
    },

    // Add-panel filters. Read-only. Each query is timed. Days and orphan never scan the graph alone.
    librarySearch(filter, limit = 40) {
      const f = normalizeLibraryFilter(filter);
      const queries = [];
      const lim = Math.max(1, Math.floor(Number(limit) || 40));
      if (!librarySelective(f)) return { rows: [], queries };
      const nowMs = Date.now();
      const since = f.days ? nowMs - f.days * 86400000 : null;
      const cap = libraryCap();
      const candidates = [];
      const seen = new Set();
      const push = (row) => {
        if (candidates.length >= cap) return false;
        const key = `${row.kind}:${row.uid || row.title}`;
        if (seen.has(key)) return false;
        seen.add(key);
        candidates.push(row);
        return true;
      };
      const timed = (name, fn) => {
        const t0 = performance.now();
        let out = [];
        try {
          const res = fn();
          out = Array.isArray(res) ? res : [];
        } catch {
          out = [];
        }
        queries.push({ name, ms: performance.now() - t0 });
        return out;
      };
      const wantPage = f.type === "all" || f.type === "page";
      const wantBlock = f.type === "all" || f.type === "block";
      const wantBoard = f.type === "all" || f.type === "board";
      const wantDaily = f.type === "daily";
      const editedOf = (value) => (Number.isFinite(value) ? value : null);

      if ((wantPage && (f.text || f.tag)) || (wantDaily && f.tag)) {
        const find = ["?t", "?u"];
        const inputs = ["$"];
        const where = [];
        const args = [];
        if (f.tag) {
          inputs.push("?name");
          args.push(f.tag);
          where.push("[?tag :node/title ?name]", "[?b :block/refs ?tag]", "[?b :block/page ?p]");
        }
        where.push("[?p :node/title ?t]");
        if (f.text) {
          inputs.push("?pat");
          args.push(ciPattern(f.text));
          where.push("[(re-pattern ?pat) ?re]", "[(re-find ?re ?t)]");
        }
        where.push("[?p :block/uid ?u]");
        if (since != null) {
          inputs.push("?since");
          args.push(since);
          find.push("?e");
          where.push("[?p :edit/time ?e]", "[(> ?e ?since)]");
        }
        const found = timed("pages", () => host.q(
          `[:find ${find.join(" ")} :in ${inputs.join(" ")} :where ${where.join(" ")}]`,
          ...args,
        ));
        const needle = f.text.toLowerCase();
        const ranked = found.slice().sort((a, b) => {
          const at = String(a?.[0] ?? "");
          const bt = String(b?.[0] ?? "");
          const ap = needle && at.toLowerCase().startsWith(needle) ? 0 : 1;
          const bp = needle && bt.toLowerCase().startsWith(needle) ? 0 : 1;
          return ap - bp || at.length - bt.length || at.localeCompare(bt);
        });
        for (const rec of ranked) {
          const title = rec?.[0];
          const uid = rec?.[1];
          if (typeof title !== "string" || title.startsWith("roam/") || !uid) continue;
          if (!push({
            kind: "page",
            title,
            uid: String(uid),
            edited: editedOf(rec?.[2]),
            tags: f.tag ? [f.tag] : [],
            onBoard: false,
          })) break;
        }
      }

      if (wantBlock && (f.text || f.tag)) {
        const find = ["?s", "?u", "?t"];
        const inputs = ["$"];
        const where = [];
        const args = [];
        if (f.tag) {
          inputs.push("?name");
          args.push(f.tag);
          where.push("[?tag :node/title ?name]", "[?b :block/refs ?tag]");
        }
        where.push("[?b :block/string ?s]");
        if (f.text) {
          inputs.push("?pat");
          args.push(ciPattern(f.text));
          where.push("[(re-pattern ?pat) ?re]", "[(re-find ?re ?s)]");
        }
        where.push("[?b :block/uid ?u]", "[?b :block/page ?p]", "[?p :node/title ?t]");
        if (since != null) {
          inputs.push("?since");
          args.push(since);
          find.push("?e");
          where.push("[?b :edit/time ?e]", "[(> ?e ?since)]");
        }
        const found = timed("blocks", () => host.q(
          `[:find ${find.join(" ")} :in ${inputs.join(" ")} :where ${where.join(" ")}]`,
          ...args,
        ));
        for (const rec of found) {
          const string = rec?.[0];
          const uid = rec?.[1];
          const pageTitle = rec?.[2];
          if (typeof string !== "string" || !uid) continue;
          if (DIAGRAM_STRING.test(string)) continue;
          if (typeof pageTitle === "string" && pageTitle.startsWith("roam/")) continue;
          const edited = since != null ? editedOf(rec?.[3]) : null;
          if (!push({
            kind: "block",
            uid: String(uid),
            string,
            pageTitle: typeof pageTitle === "string" ? pageTitle : "",
            edited,
            tags: f.tag ? [f.tag] : [],
            onBoard: false,
          })) break;
        }
      }

      if (wantBoard && (f.type === "board" || f.text || f.tag)) {
        let found;
        if (f.tag) {
          found = timed("boards", () => host.q(
            `[:find ?u ?s ?pt :in $ ?name ?pat :where [?tag :node/title ?name] [?child :block/refs ?tag]
 [?child :block/parents ?d] [?d :block/string ?s] [(re-pattern ?pat) ?re] [(re-find ?re ?s)]
 [?d :block/uid ?u] [?d :block/page ?p] [?p :node/title ?pt]]`,
            f.tag,
            DIAGRAM_RE,
          ));
        } else {
          found = timed("boards", () => host.q(
            `[:find ?u ?s ?pt :in $ ?pat :where [?b :block/string ?s] [(re-pattern ?pat) ?re] [(re-find ?re ?s)]
 [?b :block/uid ?u] [?b :block/page ?p] [?p :node/title ?pt]]`,
            DIAGRAM_RE,
          ));
        }
        for (const rec of found) {
          if (candidates.length >= cap) break;
          const uid = rec?.[0];
          const string = rec?.[1];
          const pageTitle = rec?.[2];
          if (!uid || typeof string !== "string") continue;
          const title = parseBoardTitle(string) || "Untitled board";
          if (f.text && !title.toLowerCase().includes(f.text.toLowerCase())) continue;
          let edited = null;
          let props = {};
          try {
            const res = pull("[:block/props :edit/time]", eidKey(uid));
            const raw = res?.[":block/props"];
            props = raw && typeof raw === "object" ? plainKeys(raw) : {};
            edited = editedOf(res?.[":edit/time"]);
          } catch { continue; }
          if (props?.plexus?.v !== 2) continue;
          push({
            kind: "board",
            uid: String(uid),
            title,
            string,
            pageTitle: typeof pageTitle === "string" ? pageTitle : "",
            edited,
            tags: f.tag ? [f.tag] : [],
            onBoard: true,
          });
        }
      }

      if (wantDaily && !f.tag) {
        let titles = recentDailyTitles(f.days || 14, nowMs);
        if (f.text && isDailyTitle(f.text) && !titles.includes(f.text)) titles = titles.concat(f.text);
        if (titles.length) {
          const find = "?t ?u ?e";
          const inputs = "$ [?t ...]";
          const where = ["[?p :node/title ?t]", "[?p :block/uid ?u]", "[?p :edit/time ?e]"];
          const args = [titles];
          if (since != null) {
            where.push("[(> ?e ?since)]");
            args.push(since);
          }
          const found = timed("dailies", () => host.q(
            `[:find ${find} :in ${since != null ? `${inputs} ?since` : inputs} :where ${where.join(" ")}]`,
            ...args,
          ));
          for (const rec of found) {
            const title = rec?.[0];
            const uid = rec?.[1];
            if (typeof title !== "string" || !uid) continue;
            push({
              kind: "page",
              title,
              uid: String(uid),
              edited: editedOf(rec?.[2]),
              tags: [],
              onBoard: false,
            });
          }
        }
      }

      if (f.orphan) {
        const blockUids = candidates.filter((row) => row.kind === "block" && row.uid).map((row) => row.uid);
        const pageTitles = candidates.filter((row) => row.kind === "page" && row.title).map((row) => row.title);
        const onUid = new Set();
        const onTitle = new Set();
        if (blockUids.length) {
          const direct = timed("orphan-parents", () => host.q(
            `[:find ?u :in $ [?u ...] ?pat :where [?b :block/uid ?u] [?b :block/parents ?d] [?d :block/string ?s]
 [(re-pattern ?pat) ?re] [(re-find ?re ?s)]]`,
            blockUids,
            DIAGRAM_RE,
          ));
          const via = timed("orphan-refs", () => host.q(
            `[:find ?u :in $ [?u ...] ?pat :where [?b :block/uid ?u] [?card :block/refs ?b] [?card :block/parents ?d]
 [?d :block/string ?s] [(re-pattern ?pat) ?re] [(re-find ?re ?s)]]`,
            blockUids,
            DIAGRAM_RE,
          ));
          for (const rec of [...direct, ...via]) if (rec?.[0]) onUid.add(rec[0]);
        }
        if (pageTitles.length) {
          const via = timed("orphan-pages", () => host.q(
            `[:find ?t :in $ [?t ...] ?pat :where [?p :node/title ?t] [?card :block/refs ?p] [?card :block/parents ?d]
 [?d :block/string ?s] [(re-pattern ?pat) ?re] [(re-find ?re ?s)]]`,
            pageTitles,
            DIAGRAM_RE,
          ));
          for (const rec of via) if (rec?.[0]) onTitle.add(rec[0]);
        }
        for (const row of candidates) {
          if (row.kind === "board") row.onBoard = true;
          else if (row.kind === "block") row.onBoard = onUid.has(row.uid);
          else row.onBoard = onTitle.has(row.title);
        }
      }

      const rows = narrowLibrary(candidates, f, nowMs).slice(0, lim).map(libraryCard);
      return { rows, queries };
    },

    // Graph neighbours of a card target, ordered for the Related panel:
    // attribute relations (both directions) → pages it links to → pages that link to it (grouped, counted).
    // The attribute-name page itself is not a neighbour, and blocks inside the current board are skipped.
    related(ref, limit = 60, { boardUid } = {}) {
      if (!ref || (ref.kind === "page" ? !ref.title : !ref.uid)) return [];
      const boardEid = boardUid ? host.resolveEid({ uid: boardUid }) ?? -1 : -1;
      const byPage = ref.kind === "page";
      const outgoing = host.q(
        byPage
          ? `[:find ?rt ?ss :in $ ?title :where [?p :node/title ?title] [?b :block/page ?p] [?b :block/refs ?r] [?r :node/title ?rt] [?b :block/string ?ss]]`
          : `[:find ?rt ?ss :in $ ?uid :where [?s :block/uid ?uid] (or [?b :block/parents ?s] [(= ?b ?s)]) [?b :block/refs ?r] [?r :node/title ?rt] [?b :block/string ?ss]]`,
        byPage ? ref.title : ref.uid,
      ) || [];
      const incoming = host.q(
        byPage
          ? `[:find ?u ?ss ?pt :in $ ?title ?board :where [?p :node/title ?title] [?b :block/refs ?p] (not [?b :block/parents ?board]) [(not= ?b ?board)] [?b :block/uid ?u] [?b :block/string ?ss] [?b :block/page ?pg] [?pg :node/title ?pt]]`
          : `[:find ?u ?ss ?pt :in $ ?uid ?board :where [?s :block/uid ?uid] [?b :block/refs ?s] (not [?b :block/parents ?board]) [(not= ?b ?board)] [?b :block/uid ?u] [?b :block/string ?ss] [?b :block/page ?pg] [?pg :node/title ?pt]]`,
        byPage ? ref.title : ref.uid,
        boardEid,
      ) || [];
      const attrs = [];
      const links = [];
      const pages = new Map();
      const seen = new Set();
      const add = (list, relation, target, text) => {
        const key = `${relation}|${target.kind}|${target.title ?? target.uid}`;
        if (seen.has(key)) return;
        seen.add(key);
        list.push({ relation, target, text });
      };
      for (const [rt, ss] of outgoing) {
        const attr = attrNameOf(ss);
        if (attr && rt === attr) continue; // the attribute's own name page
        if (byPage && rt === ref.title) continue;
        if (attr) add(attrs, `${attr} →`, { kind: "page", title: rt }, rt);
        else add(links, "links to", { kind: "page", title: rt }, rt);
      }
      for (const [u, ss, pt] of incoming) {
        if (u === ref.uid || (byPage && pt === ref.title)) continue;
        const attr = attrNameOf(ss);
        if (attr) { add(attrs, `← ${attr}`, { kind: "page", title: pt }, pt); continue; }
        const g = pages.get(pt) || { count: 0 };
        g.count += 1;
        pages.set(pt, g);
      }
      const linkedFrom = [...pages.entries()]
        .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
        .map(([pt, g]) => ({ relation: "linked from", target: { kind: "page", title: pt }, text: g.count > 1 ? `${pt} (${g.count})` : pt }));
      return [...attrs, ...links, ...linkedFrom].slice(0, limit);
    },

    // Pages around a card: outgoing refs, pages that mention it, or attribute values.
    // Cards on this board are not backlinks. A throw yields nothing.
    neighborPages(item, mode, { boardUid } = {}) {
      if (!item || item.type === "section") return [];
      if (mode !== "out" && mode !== "in" && mode !== "attr") return [];
      const kind = item.target?.kind || item.kind || "self";
      if (kind === "board" || item.kind === "board") return [];
      const pageTitle = kind === "page" ? String(item.target?.title || item.title || "") : "";
      const blockUid = pageTitle ? "" : String(item.target?.uid || item.uid || "");
      if (!pageTitle && !blockUid) return [];
      const byPage = Boolean(pageTitle);
      const outQuery = byPage
        ? `[:find ?rt ?ss :in $ ?title :where [?p :node/title ?title] [?b :block/page ?p] [?b :block/refs ?r] [?r :node/title ?rt] [?b :block/string ?ss]]`
        : `[:find ?rt ?ss :in $ ?uid :where [?s :block/uid ?uid] (or [?b :block/parents ?s] [(= ?b ?s)]) [?b :block/refs ?r] [?r :node/title ?rt] [?b :block/string ?ss]]`;
      const inQuery = byPage
        ? `[:find ?u ?ss ?pt :in $ ?title ?board :where [?p :node/title ?title] [?b :block/refs ?p] (not [?b :block/parents ?board]) [(not= ?b ?board)] [?b :block/uid ?u] [?b :block/string ?ss] [?b :block/page ?pg] [?pg :node/title ?pt]]`
        : `[:find ?u ?ss ?pt :in $ ?uid ?board :where [?s :block/uid ?uid] [?b :block/refs ?s] (not [?b :block/parents ?board]) [(not= ?b ?board)] [?b :block/uid ?u] [?b :block/string ?ss] [?b :block/page ?pg] [?pg :node/title ?pt]]`;
      try {
        if (mode === "in") {
          const boardEid = boardUid ? host.resolveEid({ uid: boardUid }) ?? -1 : -1;
          const incoming = host.q(inQuery, pageTitle || blockUid, boardEid) || [];
          return splitNeighbors({ incoming, selfTitle: pageTitle, selfUid: blockUid }).in;
        }
        const outgoing = host.q(outQuery, pageTitle || blockUid) || [];
        const split = splitNeighbors({ outgoing, selfTitle: pageTitle, selfUid: blockUid });
        return mode === "attr" ? split.attr : split.out;
      } catch {
        return [];
      }
    },

    // Mentions of a page or block. The info panel's cardInfo also asks which boards
    // contain the card; this query does not, so a page card can list references on mount.
    linkedRefs(item, { limit = LINKED_REF_CAP } = {}) {
      if (!item || item.type === "section") return [];
      const kind = item.target?.kind || item.kind || "self";
      const cardUid = String(item.uid ?? "");
      const pageTitle = kind === "page" ? String(item.target?.title || item.title || "") : "";
      const targetUid = kind === "block" ? String(item.target?.uid || "") : (pageTitle ? "" : cardUid);
      if (!pageTitle && !targetUid) return [];
      const cap = Number.isFinite(Number(limit)) ? Math.max(0, Math.floor(Number(limit))) : LINKED_REF_CAP;
      if (pageTitle && cache.hasLinked(`page:${pageTitle}`)) {
        const refs = [];
        const seen = new Set();
        for (const row of cache.linkedOf(`page:${pageTitle}`)) {
          const id = row?.uid;
          if (!id || id === cardUid || seen.has(id)) continue;
          seen.add(id);
          refs.push({ uid: id, string: String(row.string ?? ""), pageTitle: row.pageTitle || "" });
          if (refs.length >= cap) break;
        }
        return refs;
      }
      let rows = [];
      try {
        rows = host.q(
          pageTitle
            ? `[:find ?u ?ss ?pt :in $ ?title :where [?p :node/title ?title] [?b :block/refs ?p] [?b :block/uid ?u] [?b :block/string ?ss] [?b :block/page ?pg] [?pg :node/title ?pt]]`
            : `[:find ?u ?ss ?pt :in $ ?uid :where [?c :block/uid ?uid] [?b :block/refs ?c] [?b :block/uid ?u] [?b :block/string ?ss] [?b :block/page ?pg] [?pg :node/title ?pt]]`,
          pageTitle || targetUid,
        ) || [];
      } catch {
        return [];
      }
      const refs = [];
      const seen = new Set();
      for (const row of rows) {
        const uid = row?.[0];
        if (!uid || uid === cardUid || (targetUid && uid === targetUid) || seen.has(uid)) continue;
        seen.add(uid);
        refs.push({ uid, string: String(row?.[1] ?? ""), pageTitle: row?.[2] || "" });
        if (refs.length >= cap) break;
      }
      return refs;
    },

    // Info panel. Page-card attributes come from the page's children, not the [[title]] card.
    // Two board queries: diagrams that parent the card, and diagrams that parent a block which refs the target.
    cardInfo(item, { refLimit = 20, boardLimit = 20 } = {}) {
      if (!item || item.type === "section") return null;
      const kind = item.target?.kind || "self";
      const cardUid = String(item.uid ?? "");
      const targetUid = kind === "block" ? String(item.target?.uid || cardUid) : cardUid;
      const pageTitle = kind === "page" ? String(item.target?.title || item.title || "") : "";
      let pageUid = null;
      let body = String(item.string ?? "");
      let attrSource = [];
      if (pageTitle) {
        const page = host.pullPage(pageTitle);
        pageUid = page?.[":block/uid"] ?? null;
        const kids = Array.isArray(page?.[":block/children"]) ? page[":block/children"] : [];
        attrSource = kids.map((k) => k?.[":block/string"] ?? "");
        body = pageTitle;
      } else if (targetUid) {
        let res = null;
        try { res = pull("[:block/string {:block/children [:block/string]}]", eidKey(targetUid)); } catch { res = null; }
        if (res) {
          body = res[":block/string"] ?? body;
          const kids = Array.isArray(res[":block/children"]) ? res[":block/children"] : [];
          attrSource = kids.map((k) => k?.[":block/string"] ?? "");
        }
      }
      const parentRows = cardUid
        ? host.q(
          `[:find ?u ?s ?pt :in $ ?uid ?pat :where [?c :block/uid ?uid] [?c :block/parents ?d] [?d :block/uid ?u] [?d :block/string ?s]
 [(re-pattern ?pat) ?re] [(re-find ?re ?s)] [?d :block/page ?p] [?p :node/title ?pt]]`,
          cardUid,
          DIAGRAM_RE,
        ) || []
        : [];
      const viaRows = (pageTitle || targetUid)
        ? host.q(
          pageTitle
            ? `[:find ?u ?s ?pt :in $ ?title ?pat :where [?t :node/title ?title] [?b :block/refs ?t] [?b :block/parents ?d] [?d :block/uid ?u] [?d :block/string ?s]
 [(re-pattern ?pat) ?re] [(re-find ?re ?s)] [?d :block/page ?p] [?p :node/title ?pt]]`
            : `[:find ?u ?s ?pt :in $ ?uid ?pat :where [?c :block/uid ?uid] [?b :block/refs ?c] [?b :block/parents ?d] [?d :block/uid ?u] [?d :block/string ?s]
 [(re-pattern ?pat) ?re] [(re-find ?re ?s)] [?d :block/page ?p] [?p :node/title ?pt]]`,
          pageTitle || targetUid,
          DIAGRAM_RE,
        ) || []
        : [];
      const refRows = (pageTitle || targetUid)
        ? host.q(
          pageTitle
            ? `[:find ?u ?ss ?pt :in $ ?title :where [?p :node/title ?title] [?b :block/refs ?p] [?b :block/uid ?u] [?b :block/string ?ss] [?b :block/page ?pg] [?pg :node/title ?pt]]`
            : `[:find ?u ?ss ?pt :in $ ?uid :where [?c :block/uid ?uid] [?b :block/refs ?c] [?b :block/uid ?u] [?b :block/string ?ss] [?b :block/page ?pg] [?pg :node/title ?pt]]`,
          pageTitle || targetUid,
        ) || []
        : [];
      const rawBoards = [];
      for (const [uid, string, pt] of [...parentRows, ...viaRows]) {
        if (!uid) continue;
        let props = {};
        try { props = host.pullProps(uid); } catch { continue; }
        if (props?.plexus?.v !== 2) continue;
        rawBoards.push({
          uid,
          title: parseBoardTitle(string) || "Untitled board",
          pageTitle: pt || "",
          v: 2,
        });
      }
      const refs = [];
      const seenRef = new Set();
      for (const [uid, string, pt] of refRows) {
        if (!uid || uid === cardUid || seenRef.has(uid)) continue;
        seenRef.add(uid);
        refs.push({ uid, string: String(string ?? "").slice(0, 160), pageTitle: pt || "" });
        if (refs.length >= refLimit) break;
      }
      return {
        kind,
        uid: pageTitle ? pageUid : targetUid,
        cardUid,
        pageUid,
        title: item.title || pageTitle || "",
        body,
        attributes: attributeRows(attrSource),
        refs,
        boards: boardsFromRows(rawBoards, { limit: boardLimit }),
        tags: tagNames([body, ...attrSource].join("\n")),
      };
    },

    // Where "Show on board" should land. Read-only. A placed card on a v2 board wins over a card that merely refs the block.
    showOnBoard(uid) {
      const id = String(uid ?? "").trim();
      if (!id) return null;
      const propsOf = (blockUid) => {
        try { return host.pullProps(blockUid); } catch { return {}; }
      };
      let direct = [];
      let via = [];
      try {
        direct = host.q(SHOW_DIRECT_QUERY, id, DIAGRAM_RE) || [];
        via = host.q(SHOW_REF_QUERY, id, DIAGRAM_RE) || [];
      } catch {
        return null;
      }
      const boardOk = new Map();
      const enhanced = (boardUid) => {
        if (!boardOk.has(boardUid)) boardOk.set(boardUid, propsOf(boardUid)?.plexus?.v === 2);
        return boardOk.get(boardUid);
      };
      const placements = [];
      for (const row of direct) {
        const boardUid = row?.[0];
        const pageUid = row?.[1];
        if (!boardUid || !pageUid || !enhanced(boardUid)) continue;
        if (!isShowableCard(propsOf(id)?.plexus)) continue;
        placements.push({ boardUid, pageUid, cardUid: id, refUids: [] });
      }
      for (const row of via) {
        const boardUid = row?.[0];
        const pageUid = row?.[1];
        const cardUid = row?.[2];
        if (!boardUid || !pageUid || !cardUid || cardUid === id || !enhanced(boardUid)) continue;
        if (!isShowableCard(propsOf(cardUid)?.plexus)) continue;
        placements.push({ boardUid, pageUid, cardUid, refUids: [id] });
      }
      return locateShowTarget(id, placements);
    },
  };
  host.prefetchBoard.warm = (uid) => Boolean(cache.blockOf(String(uid ?? ""))?.[":block/uid"]);
  host.prefetchBoard.refBoards = (uid) => cache.refBoardsOf(String(uid ?? ""));
  host.prefetchBoard.pageBoards = (title) => cache.pageBoardsOf(typeof title === "string" ? title : "");
  return host;
}
