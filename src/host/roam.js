import { isShowableCard, locateShowTarget } from "../model/deeplink.js";
import { attributeRows, boardsFromRows, tagNames } from "../model/info.js";
import {
  blockDisplay,
  isDailyTitle,
  libraryCap,
  libraryCard,
  libraryKind,
  librarySelective,
  narrowLibrary,
  queryTerms,
  normalizeLibraryFilter,
  recentDailyTitles,
  wantsType,
} from "../model/library.js";
import { assembleMeta, createMetaCache, META_REFS, USER_NAME_QUERIES, metaFilterHostActive, narrowByMeta, sortNeedsMeta, sortRows } from "../model/search-sort.js";
import { splitNeighbors } from "../model/neighbors.js";
import { linkedRefRows } from "../model/linked-cards.js";
import { coverModel, pdfMacroUrl, pdfPagePlan } from "../model/pdf.js";
import { pdfOfPageNode } from "../model/pdf-page.js";
import { SEM_PULL, relatedQueryText, semanticCandidates } from "../model/semantic.js";
import { BROWSE_CHUNK, BROWSE_ROWS, BROWSE_SCAN, FILTER_BROWSE_MAX, FILTER_BROWSE_TTL_MS, browseCountBy, browseKey, browseOrdered, browseQuery, browseSpec, orderBrowse } from "../model/filter-browse.js";
import { LINKED_REF_CAP } from "../model/refs.js";
import { createCardCache } from "../model/card-cache.js";
import { attrNameOf, classifyString, mergePropsForWrite, parseBoardTitle, plainKeys } from "../model/schema.js";
import { dailyTitle, dailyUid, journalRows } from "../model/journal.js";
import { closeTab, normalizeTabs, openTab, tabStorageKey } from "../model/tabs.js";
import { bindGuardStats, guardCallback } from "../guard.js";
import { installCommentHost } from "./comments.js";
import { SPLIT_WATCH_MIN, containerKind, createSplitWatch, treeSize } from "./split-watch.js";
import { notedSpeedFlags } from "../settings.js";
import { buildBoard } from "../model/board.js";
import { linksQuery, reduceLinks } from "../model/links.js";
import { createSlicedRead, SLICED_SLICE_MS } from "./sliced-read.js";
import { createTreeDecoder, createTreeEncoder, packDerived, unpackDerived } from "./model-store.js";
import { createPartSizer } from "../part-sizer.js";
import { sharedBgBudget } from "../bg-budget.js";

// Pull results equal but for Roam's own reader state (:pdf-settings: page, scale). Exits at the first other change.
const READER_STATE = ":pdf-settings";
export function sameButReaderState(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (!sameButReaderState(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  let n = 0;
  for (const k in a) {
    if (k === READER_STATE) continue;
    n += 1;
    if (!(k in b) || !sameButReaderState(a[k], b[k])) return false;
  }
  for (const k in b) if (k !== READER_STATE) n -= 1;
  return n === 0;
}

export const BOARD_PATTERN = `[:block/uid :block/string :block/order :block/heading :block/open :block/props
 {(limit :block/children nil) [:block/uid :block/string :block/order :block/heading :block/open :block/props
   {(limit :block/children nil) [:block/uid :block/string :block/order :block/heading :block/open :block/props
     {(limit :block/children nil) ...}]}]}]`;

// One pull of the board also brings card refs, page outlines, and native diagram attrs.
// The inner `...` repeats that level only, so a page outline does not pull refs of refs.
const REF_CHILD = `[:block/uid :block/string :block/order :block/heading :block/open :block/props
 {(limit :block/children nil) [:block/uid :block/string :block/order :block/heading :block/open :block/props
   {(limit :block/children nil) ...}]}]`;
const NATIVE_PULL = `{:diagram/nodes [:db/id :diagram.node/data {:diagram.node/block [:block/uid :block/string]} {:diagram.node/parent-node [:db/id]}]}
 {:diagram/edges [{:diagram.edge/source [:db/id]} {:diagram.edge/target [:db/id]} :diagram.edge/data]}`;
const REF_BODY = `[:db/id :block/uid :block/string :node/title :block/order :block/heading :block/open :block/props :pdf/url
 {:block/page [:node/title :block/uid :pdf/url]}
 ${NATIVE_PULL}
 {(limit :block/children nil) ${REF_CHILD}}]`;
// One outline level. Children are ids only, so the next pull is the next level. No recursive `...`.
const LEVEL_ROOT = `[:db/id :block/uid :block/string :node/title :block/order :block/heading :block/open :block/props :pdf/url
 {:block/page [:node/title :block/uid :pdf/url]}
 ${NATIVE_PULL}
 {(limit :block/children nil) [:block/uid :block/order]}]`;
const LEVEL_KID = `[:block/uid :block/string :block/order :block/heading :block/open :block/props
 {(limit :block/children nil) [:block/uid :block/order]}]`;
export const OUTLINE_BATCH = 20;

// Idle ref reads. start() and step() each do one pull_many of at most `batch` nodes, all on the same level.
// entities() is the finished roots once pending() is 0. A synchronous ref read stays on REF_BODY.
export function createOutlineAssembler({ pullMany, batch = OUTLINE_BATCH } = {}) {
  const queue = [];
  const roots = [];
  const take = (n) => {
    if (!queue.length) return true;
    const limit = Number.isFinite(n) ? Math.max(1, Math.floor(n)) : batch;
    const root = queue[0].root === true;
    const part = [];
    while (part.length < limit && queue.length && queue[0].root === root) part.push(queue.shift());
    let nodes = [];
    try { nodes = pullMany?.(root ? LEVEL_ROOT : LEVEL_KID, part.map((slot) => slot.entity)) || []; } catch { nodes = []; }
    if (!Array.isArray(nodes)) nodes = [];
    part.forEach((slot, i) => {
      const raw = nodes[i];
      const node = raw && typeof raw === "object" ? raw : {};
      let current = node;
      if (slot.root) roots.push(node);
      else if (slot.parent && slot.stub) {
        const list = slot.parent[":block/children"];
        const at = Array.isArray(list) ? list.indexOf(slot.stub) : -1;
        current = at >= 0 ? { ...slot.stub, ...node } : node;
        if (at >= 0) list[at] = current;
      }
      const kids = Array.isArray(current[":block/children"]) ? current[":block/children"] : [];
      if (!Array.isArray(current[":block/children"])) current[":block/children"] = kids;
      for (const kid of kids) {
        const id = kid?.[":block/uid"];
        if (typeof id !== "string" || !id) continue;
        queue.push({ entity: [":block/uid", id], root: false, parent: current, stub: kid });
      }
    });
    return queue.length === 0;
  };
  return {
    addRoots(uids, titles) {
      for (const id of uids || []) if (typeof id === "string" && id) queue.push({ entity: [":block/uid", id], root: true });
      for (const title of titles || []) if (typeof title === "string" && title) queue.push({ entity: [":node/title", title], root: true });
    },
    pending: () => queue.length,
    entities: () => roots,
    start: (n) => take(n),
    step: (n) => take(n),
  };
}
const OPEN_PATTERN = `[:db/id :block/uid :block/string :block/order :block/heading :block/open :block/props
 {:block/page [:block/uid :pdf/url]}
 {:block/parents [:block/uid :block/string :block/props {:block/parents [:db/id]}]}
 ${NATIVE_PULL}
 {:block/refs ${REF_BODY}}
 {(limit :block/children nil) [:db/id :block/uid :block/string :block/order :block/heading :block/open :block/props
   {:block/refs ${REF_BODY}}
   ${NATIVE_PULL}
   {(limit :block/children nil) [:db/id :block/uid :block/string :block/order :block/heading :block/open :block/props
     {:block/refs ${REF_BODY}}
     ${NATIVE_PULL}
     {(limit :block/children nil) ...}]}]}]`;

// OPEN_PATTERN joins every ref's whole body into the board pull, and the board's pull watch re-runs it on every
// change. Its cost follows the blocks with refs (PhD boards: <= 100 → mostly < 100 ms; 300 → ~1 s; main board 8,298
// → 11.3 s and 148 MB per pull). Above this many, the board pull is BOARD_PATTERN and refs are pulled once.
export const OPEN_PULL_MAX_REFS = 120;
const REF_TEXT = /\[\[|\(\(|#\S|::/;
// Blocks under the root whose text names a page, a block, a tag or an attribute (stops past `cap`).
export function refBlocksOf(node, cap = Infinity) {
  let n = 0;
  const stack = [...childNodes(node)];
  while (stack.length && n <= cap) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    if (REF_TEXT.test(String(cur[":block/string"] ?? ""))) n += 1;
    for (const kid of childNodes(cur)) stack.push(kid);
  }
  return n;
}

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

// Card stats in idle chunks only past this many items (sections' members counted): Parse Lab is past
// SPLIT_WATCH_MIN blocks (parsed PDFs) with few items, and its 80-target chunks were 58-98 ms tasks under the first pans.
const STATS_CHUNK_ITEMS = 400;
// Or past this many stat targets whatever the item count (400 cards of 40 rows each were one 16,400-target call).
const STATS_ONE_CALL_MAX = 10000;
function manyItems(node) {
  let n = 0;
  const walk = (cur, atRoot) => {
    for (const kid of childNodes(cur)) {
      n += 1;
      if (n > STATS_CHUNK_ITEMS) return true;
      // Sections inside sections: their members are items too.
      if (containerKind(kid, atRoot) === "struct" && walk(kid, false)) return true;
    }
    return false;
  };
  return walk(node, true);
}
const statsInParts = (node, targets) => manyItems(node) || targets.length > STATS_ONE_CALL_MAX;

// Page cards and block refs named by card strings. Nested outline rows are not cards.
export function collectTargets(node) {
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

// collectTargets in resumable steps (P8 U3: a sliced read finishes it before the acquire). Same order: a node, then
// its children in order, depth first. step(budgetMs, clock) is true when done; result() is collectTargets(node).
export function createTargetsWalk(node) {
  const titles = [];
  const uids = [];
  const stats = [];
  const stack = node && typeof node === "object" ? [[node, true]] : [];
  let out = null;
  return {
    step(budgetMs = Infinity, clock = () => 0) {
      const t0 = clock();
      let n = 0;
      while (stack.length) {
        const [cur, isRoot] = stack.pop();
        if (cur && typeof cur === "object") {
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
          const kids = childNodes(cur);
          for (let i = kids.length - 1; i >= 0; i -= 1) stack.push([kids[i], false]);
        }
        n += 1;
        if ((n & 255) === 0 && clock() - t0 >= budgetMs) return false;
      }
      return true;
    },
    result() {
      if (stack.length) return null;
      if (!out) out = { titles: uniqueStrings(titles), uids: uniqueStrings(uids), stats };
      return out;
    },
  };
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
const BLOCK_KIND_PATTERNS = {
  pdf: "\\{\\{(\\[\\[)?pdf(\\]\\])?:",
  image: "!\\[[^\\]]*\\]\\(",
  web: "^\\s*(\\[[^\\]]*\\]\\(\\s*)?https?://\\S+\\)?\\s*$",
  region: "plexus-region\\]\\]:",
  pin: "plexus-pin\\]\\]:",
};
const DIAGRAM_STRING = /^\s*\{\{(?:\[\[)?diagram/i;
const DIAGRAM_FIND = new RegExp(DIAGRAM_RE);
// Index lookup. A `[?t ...]` binding on :block/refs scans every refs datom in the graph.
const STATS_PULL = `[:db/id {(limit :block/_refs nil) [:db/id {:block/parents [:db/id :block/string]}]} {(limit :block/_parents nil) [:db/id {:block/refs [:db/id]}]} {:block/_page [:db/id {:block/refs [:db/id]}]}]`;

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
const BOARD_META_PATTERN = "[:block/props :edit/time {(limit :block/children nil) [:block/props]}]";
const PDF_PAGE_QUERY = `[:find ?u ?t :in $ ?url :where [?p :pdf/url ?url] [?p :block/uid ?u] [?p :node/title ?t]]`;
// Every block with props on a Roam PDF page, with the page's :pdf/url: highlight counts for all PDFs in one read.
const PDF_HIGHLIGHTS_QUERY = `[:find ?url ?props :where [?p :pdf/url ?url] [?b :block/page ?p] [?b :block/props ?props]]`;
const CHILD_COUNTS = "[:find ?b (count ?k) :in $ [?b ...] :where [?b :block/children ?k]]";
const BROWSE_COUNT_MAX = 5000;
const BROWSE_PULL = "[:db/id :block/uid :block/string :node/title :block/props {:block/page [:node/title]}]";
const USER_EID_QUERIES = Object.freeze([
  "[:find ?x ?n :where [?x :user/display-name ?n]]",
  "[:find ?x ?n :where [?x :user/uid _] [?x :user/display-page ?d] [?d :node/title ?n]]",
]);
const PDF_PAGE_BLOCKS_QUERY = `[:find ?props :in $ ?uid :where [?p :block/uid ?uid] [?b :block/page ?p] [?b :block/props ?props]]`;
// Every Roam PDF page, and every block with props on one: one read covers all PDF cards on a big board.
const PDF_PAGES_ALL_QUERY = `[:find ?url ?u ?t :where [?p :pdf/url ?url] [?p :block/uid ?u] [?p :node/title ?t]]`;
// Highlight blocks per Roam PDF page, counted in the query (P9 live: 57-64 ms, against 101-119 ms for the 3,445 props
// rows the count used to be made from in JS; same 127 counts).
const PDF_PAGE_COUNTS_ALL_QUERY = `[:find ?u (count-distinct ?b) :where [?p :pdf/url _] [?p :block/uid ?u] [?b :block/page ?p] [?b :block/props ?props]
 (or [(contains? ?props :pdf-highlight)] [(contains? ?props "pdf-highlight")])]`;
// A board that names this many PDFs reads covers from one index (PhD board: 122 PDFs asked ~8,900 times in one open,
// 5 ms each, against 31-71 ms for the whole index). The index lives COVER_INDEX_MIN_MS, or 40× its own read time.
// Below the break-even a board reads per url, as 3.27.0 did: at 4, Parse Lab re-read the expired index on a zoom-out
// mount (a 71 ms query, 75-83 ms tasks).
export const COVER_INDEX_URLS = 15;
export const COVER_INDEX_MIN_MS = 2000;
const PDF_BLOCK_OUT_QUERY = `[:find ?u :in $ ?page ?url :where [?p :block/uid ?page] [?p :block/refs ?b] [?b :block/string ?s] [(clojure.string/includes? ?s ?url)] [?b :block/uid ?u]]`;
const PDF_BLOCK_IN_QUERY = `[:find ?u :in $ ?page ?url :where [?p :block/uid ?page] [?b :block/refs ?p] [?b :block/string ?s] [(clojure.string/includes? ?s ?url)] [?b :block/uid ?u]]`;
// The pdf block's pins container and its pins: two levels, nothing deeper.
const PDF_KIDS_PATTERN = `[:block/uid {(limit :block/children nil) [:block/uid :block/string :block/order :block/props
 {(limit :block/children nil) [:block/uid :block/string :block/order :block/props]}]}]`;
const LINK_REFS_QUERY = "[:find ?b ?src :in $ [?b ...] :where [?src :block/refs ?b]]";
const LINK_SRC_PATTERN = "[:db/id :block/uid :block/string {:block/page [:db/id]} {:block/parents [:db/id]} {:block/_children [:block/string]}]";
const OUTLINE_KIDS_PATTERN = "[:block/uid {(limit :block/children nil) [:block/uid :block/string :block/open :block/order]}]";
const PDF_PAGE_PATTERN = "[:block/uid :node/title {(limit :block/children nil) [:block/uid :block/string :block/order]}]";
const PDF_HASH_PAGE_QUERY = `[:find ?u ?t :in $ ?h :where [?p :pdf/content-hash ?h] [?p :block/uid ?u] [?p :node/title ?t]]`;
const PDF_TOP_BLOCK_QUERY = `[:find ?u ?t :in $ ?url :where [?b :block/string ?s] [(clojure.string/includes? ?s ?url)] [?b :block/page ?p] [?p :block/children ?b] [?p :block/uid ?u] [?p :node/title ?t]]`;
const CHILDREN_WATCH_PATTERN = "[:block/uid {(limit :block/children nil) [:block/uid :block/order]}]";
const BLOCK_PROPS_PATTERN = "[:block/string :block/props {:block/page [:node/title]}]";
// Children too, so a highlight card sees its note change. The string path ignores child-only fires.
const BLOCK_WATCH_PATTERN = "[:block/string {(limit :block/children nil) [:block/string :block/order :block/props]}]";
const HIGHLIGHT_TREE_PATTERN = `[:block/uid
 {(limit :block/children nil) [:block/uid :block/string :block/order :block/props
   {(limit :block/children nil) [:block/uid :block/string :block/order :block/props
     {(limit :block/children nil) [:block/uid :block/string :block/order :block/props
       {(limit :block/children nil) [:block/uid :block/string :block/order :block/props]}]}]}]}]`;

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

// PXD-4: rows for a page card's plain preview. A folded block keeps its child count (`kids`), not its children, so a
// big folded block does not use up the budget the blocks after it need.
function previewTree(node, depth, budget) {
  const out = [];
  if (depth < 1) return out;
  for (const c of sortedKids(node)) {
    if (budget.left <= 0) break;
    budget.left--;
    const folded = c[":block/open"] === false;
    const kids = Array.isArray(c[":block/children"]) ? c[":block/children"].length : 0;
    out.push({
      uid: c[":block/uid"],
      string: c[":block/string"] ?? "",
      ...(folded ? { open: false, kids } : {}),
      children: folded ? [] : previewTree(c, depth - 1, budget),
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
  const tokens = text.replace(/\(limit\s+(:[^\s()]+)\s+(?:nil|\d+)\s*\)/g, "$1").match(/\.\.\.|[[\]{}]|:[^\s[\]{}]+|[^\s[\]{}]+/g) || [];
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

// Roam refuses more than 1,500 API mutations per 60 s ("maximum mutation rate limit exceeded"), and a long backlog of
// unconfirmed writes drains in time that grows with its length (PhD stress build: 18k queued writes, ~30 h). Every
// Plexus write waits here: `burst` writes per minute go at once (a 50-card drag, a 20-card delete), then one per
// `gapMs`, and never more than `cap` in any 60 s.
export const WRITE_BURST = 200;
export const WRITE_GAP_MS = 100;
export const WRITE_CAP = 1200;
// Under Roam's undo depth (50). A native group larger than this is split, so one Cmd+Z would undo only the tail.
export const MAX_GROUP_WRITES = 45;
// Content-watch arms wait while the last minute holds this many paced calls (writes plus watch calls).
export const WATCH_ARM_LOW = 900;
export const WATCH_ARM_RETRY_MS = 5000;
// A big board's split watch stays registered and quiet this long after its last subscriber parks or leaves.
export const SPLIT_HOLD_MS = 60000;
export function isRateLimitError(error) {
  return /mutation rate limit|rate limit exceeded/i.test(String(error?.message ?? error ?? ""));
}
export function createWritePacer({ now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), burst = WRITE_BURST, gapMs = WRITE_GAP_MS, cap = WRITE_CAP, windowMs = 60000 } = {}) {
  // `stamps` holds every call Roam counts (writes and watch calls) for the cap; `writes` holds writes alone for the
  // burst gap, so the extension's own watch bookkeeping never slows a user's drag or undo.
  const stamps = [];
  const writes = [];
  let chain = Promise.resolve();
  const trim = (t) => {
    while (stamps.length && t - stamps[0] >= windowMs) stamps.shift();
    while (writes.length && t - writes[0] >= windowMs) writes.shift();
  };
  const take = async () => {
    let t = now();
    trim(t);
    if (stamps.length >= cap) {
      await sleep(stamps[0] + windowMs - t);
      t = now();
      trim(t);
    } else if (writes.length >= burst) {
      const wait = writes[writes.length - 1] + gapMs - t;
      if (wait > 0) {
        await sleep(wait);
        t = now();
      }
    }
    stamps.push(t);
    writes.push(t);
  };
  return {
    // Resolves when this write may go. Calls queue in order.
    pace() {
      const p = chain.then(take);
      chain = p.catch(() => {});
      return p;
    },
    // A call that Roam counts but that does not wait (add/removePullWatch): it counts toward the cap only.
    note() {
      const t = now();
      trim(t);
      stamps.push(t);
    },
    // Roam refused a write: count the window as full so the next write waits it out.
    saturate() {
      const t = now();
      trim(t);
      while (stamps.length < cap) stamps.push(t);
    },
    get recent() { trim(now()); return stamps.length; },
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

// INSTANT-6. Counts Datascript reads (q, pull, pull_many, fast.q) on stats.reads, so an
// open can report how many reads ran before its first paint.
const READ_FNS = new Set(["q", "pull", "pull_many"]);
function countReads(data, stats) {
  if (!data || typeof data !== "object" || typeof Proxy !== "function") return data;
  stats.reads = 0;
  const wrapped = new Map();
  const wrap = (owner, prop, fn) => {
    const key = owner === data ? prop : `fast.${prop}`;
    const hit = wrapped.get(key);
    if (hit && hit.fn === fn) return hit.out;
    const out = function counted(...args) {
      stats.reads += 1;
      return fn.apply(owner, args);
    };
    wrapped.set(key, { fn, out });
    return out;
  };
  let fastProxy = null;
  let fastOf = null;
  return new Proxy(data, {
    get(target, prop) {
      const value = target[prop];
      if (typeof prop === "string" && READ_FNS.has(prop) && typeof value === "function") return wrap(target, prop, value);
      if (prop === "fast" && value && typeof value === "object") {
        if (fastOf !== value) {
          fastOf = value;
          fastProxy = new Proxy(value, {
            get(fast, name) {
              const fn = fast[name];
              return name === "q" && typeof fn === "function" ? wrap(fast, name, fn) : fn;
            },
          });
        }
        return fastProxy;
      }
      // Other methods run against the real object, as before the proxy.
      if (typeof value === "function") {
        const key = `bound.${String(prop)}`;
        const hit = wrapped.get(key);
        if (hit && hit.fn === value) return hit.out;
        const out = value.bind(target);
        wrapped.set(key, { fn: value, out });
        return out;
      }
      return value;
    },
  });
}

const BROWSE_TTL_MS = 30000;

export function createHost({ api = globalThis.roamAlphaAPI, storage = globalThis.localStorage, graph, now, sleep } = {}) {
  const pacer = createWritePacer({
    ...(typeof now === "function" ? { now } : {}),
    ...(typeof sleep === "function" ? { sleep } : {}),
  });
  // One Roam mutation, paced; a refusal at Roam's rate cap waits out the window and tries once more.
  const mutate = async (fn) => {
    await pacer.pace();
    try {
      return await fn();
    } catch (error) {
      if (!isRateLimitError(error)) throw error;
      pacer.saturate();
      await pacer.pace();
      return await fn();
    }
  };
  const stats = { writes: 0, watches: 0, pageWatches: 0, renders: 0, items: {}, errors: 0 };
  bindGuardStats(stats);
  const data = countReads(api.data, stats);
  // add/removePullWatch count toward Roam's 1,500/min limiter too: they spend the write pacer's budget, so a burst of
  // watch churn makes writes wait instead of Roam refusing them (and openPage).
  // Every registration this host holds (cb -> [pattern, entity] pairs), so dispose() can remove them all at unload.
  const registered = new Map();
  const watchData = new Proxy(data, {
    get(target, prop) {
      if (prop === "addPullWatch") {
        return (pattern, entity, cb, ...rest) => {
          pacer.note();
          const out = target.addPullWatch(pattern, entity, cb, ...rest);
          let list = registered.get(cb);
          if (!list) { list = []; registered.set(cb, list); }
          list.push([pattern, entity]);
          return out;
        };
      }
      if (prop === "removePullWatch") {
        return (pattern, entity, cb, ...rest) => {
          pacer.note();
          const list = registered.get(cb);
          if (list) {
            const at = list.findIndex(([p, e]) => p === pattern && e === entity);
            if (at >= 0) list.splice(at, 1);
            if (!list.length) registered.delete(cb);
          }
          return target.removePullWatch(pattern, entity, cb, ...rest);
        };
      }
      const value = target[prop];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  // Every data.block.* call is its own Roam undo entry. The log groups the calls of one session transaction
  // (host.group) so one undo()/redo() steps over the whole user operation. A write outside a group is its own step.
  // A native group holds at most MAX_GROUP_WRITES writes: a larger transaction is split into consecutive groups (one
  // plexus undo entry, so one Cmd+Z, per chunk) so every entry stays inside Roam's own undo depth and undo never has
  // to clean up with deletes (those would land on Roam's stack and resurrect blocks on the next Cmd+Z). A custom undo
  // entry is not split: one Cmd+Z runs its inverse, which may itself be hundreds of writes.
  const undoLog = [];
  const redoLog = [];
  const UNDO_LOG_MAX = 200;
  const UNDO_ECHO_MS = 900; // Roam echoes our own writes back through the pull watch; those are not foreign edits
  let openGroup = null;
  let silent = false; // inverse writes of a custom undo entry: they are not new user steps
  // A custom entry's undo/redo writes land on Roam's native stack, so the native entries below it in the log no longer
  // match that stack. They are dropped and this floor stops undo/redo from falling back to a blind data.undo().
  let nativeFloor = false;
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
  let structureEpoch = 0;
  const noteWrite = (kind) => {
    // A block made, moved or deleted can put a card on a board or take it off: "Not on any board" browses re-run.
    if (kind === "create" || kind === "move" || kind === "delete") structureEpoch += 1;
    dropBurst();
    lastWriteAt = Date.now();
    if (silent) return;
    redoLog.length = 0;
    if (openGroup) {
      if (openGroup.n >= MAX_GROUP_WRITES && !openGroup.custom) {
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
  // P8 U3: sliced reads waiting for their pullBoard, by board uid: { tree, stamp, at }. An offer is for the open that
  // read it: folds do not move the stamp, so an older one is never used.
  const OFFER_TTL_MS = 2000;
  const offeredTrees = new Map();
  // P9: block props read ahead of an acquire (uid -> { at, res }), used by blockProps for PRIMED_PROPS_MS.
  const primedProps = new Map();
  const PRIMED_PROPS_MS = 3000;
  const PRIME_PROPS_BATCH = 400;
  const primePropsPart = (uids, at, n) => {
    const ids = uids.slice(at, at + n);
    if (!ids.length || typeof data.pull_many !== "function") return uids.length;
    const res = data.pull_many(BLOCK_PROPS_PATTERN, ids.map((u) => [":block/uid", u]));
    if (!Array.isArray(res) || res.length !== ids.length) return uids.length;
    const now = Date.now();
    if (at === 0) primedProps.clear();
    for (let i = 0; i < ids.length; i += 1) primedProps.set(ids[i], { at: now, res: res[i] ?? null });
    return at + ids.length;
  };
  // P9: offers a preread already took in (absorbed, split created and held): { node, found, stamp, at, split, trusted }.
  const adoptedTrees = new Map();
  // The adopt step of a cold open, in its own task: what pullBoard would do with a big board's offer (absorb, the split
  // watch, the trust mark), so the acquire task only builds the model. The split is held until the session attaches:
  // a change meanwhile publishes on attach, and an open that never comes lets it go after SPLIT_HOLD_MS.
  const adoptOffer = (uid) => {
    const offered = offeredTrees.get(uid);
    if (!offered || !splitWatchOn() || splitWatches.has(uid)) return false;
    // trustSnapshot off restores the 3.29.0 open: nothing is absorbed and no split is held before acquire.
    // The offer stays, and pullBoard uses it only while the page stamp still matches.
    if (!trustOn()) return false;
    if (Date.now() - offered.at > OFFER_TTL_MS || pageStampOf(uid) !== offered.stamp) { offeredTrees.delete(uid); return false; }
    if (treeSize(offered.tree, SPLIT_WATCH_MIN) < SPLIT_WATCH_MIN) return false;
    if (offered.trusted && !trustOn()) { offeredTrees.delete(uid); return false; }
    offeredTrees.delete(uid);
    const tree = offered.tree;
    absorb(uid, tree, false);
    bigBoards.set(uid, tree);
    boardCovers.set(uid, false);
    let split = null;
    try { split = splitFor(uid); } catch { split = null; }
    if (!split) return false;
    holdSplit(uid, split);
    if (offered.trusted) unverified.set(uid, offered.stamp);
    else if (modelStore && trustOn() && modelStore.stampOf(uid) !== offered.stamp) keepModel(uid, tree, offered.stamp);
    adoptedTrees.set(uid, { node: tree, found: offered.found, stamp: offered.stamp, at: Date.now(), split, trusted: offered.trusted === true, derived: offered.derived ?? null });
    return true;
  };
  // The board's page stamp "edit-time|edit-nonce", or null when Roam has none.
  const pageStampOf = (uid) => {
    let pageUid = "";
    try { pageUid = String(host.blockPageUid?.(uid) || ""); } catch { pageUid = ""; }
    if (!pageUid) return null;
    let p = null;
    try { p = rawPull("[:page/edit-time :page/edit-nonce]", eidKey(pageUid)); } catch { p = null; }
    const t = p?.[":page/edit-time"];
    const n = p?.[":page/edit-nonce"];
    if (t == null && n == null) return null;
    return `${t ?? ""}|${n ?? ""}`;
  };
  // P9. Trusted open: a big board whose page stamp is the one its stored model was read at mounts from that model
  // with no board read. Until a background read verifies it, the board is "unverified" (boardUnverified): nothing
  // destructive may act on it. Speed flag trustSnapshot.
  const trustOn = () => { try { return notedSpeedFlags().trustSnapshot !== false; } catch { return true; } };
  const derivedOn = () => { try { return notedSpeedFlags().storedDerived !== false; } catch { return true; } };
  // uid -> { stamp, badges: Map, links }. Seeded from the store on a trusted hit; replaced by the check.
  const derivedLive = new Map();
  const seedDerived = (uid, stamp, raw) => {
    if (!derivedOn()) return false;
    const unpacked = unpackDerived(raw);
    if (!unpacked) return false;
    derivedLive.set(uid, { stamp, badges: unpacked.badges, links: unpacked.links });
    return true;
  };
  // Full links from a verified tree: the same reduce the session's link job does, in one pass.
  function linksFromTree(uid, tree) {
    let board = null;
    try {
      board = buildBoard(tree, {
        resolve: (id) => {
          try {
            const text = host.blockString?.(id);
            return typeof text === "string" ? text : null;
          } catch { return null; }
        },
      });
    } catch { return []; }
    if (!board) return [];
    const resolved = new Map();
    const resolveOnce = (ref) => {
      const key = ref.title != null ? `title:${ref.title}` : `uid:${ref.uid}`;
      if (resolved.has(key)) return resolved.get(key);
      let eid = null;
      try { eid = host.resolveEid(ref); } catch { eid = null; }
      resolved.set(key, eid);
      return eid;
    };
    const boardEid = resolveOnce({ uid });
    const eidToItems = new Map();
    for (const item of board.items.values()) {
      if (item.type !== "card" || !item.target) continue;
      const t = item.target;
      const ref = t.kind === "page" ? { title: t.title } : { uid: t.uid };
      const eid = resolveOnce(ref);
      if (eid == null || eid === boardEid) continue;
      if (!eidToItems.has(eid)) eidToItems.set(eid, []);
      eidToItems.get(eid).push(item.uid);
    }
    const eids = [...eidToItems.keys()];
    if (!eids.length || boardEid == null) return [];
    let rows = [];
    try { rows = host.linkRows(boardEid, new Set(eids), eids) || []; } catch { return []; }
    const parentStrings = new Map();
    for (const row of rows) {
      if (row.length > 4 && row[4] != null) parentStrings.set(row[2], row[4]);
    }
    try { return reduceLinks(rows, { eidToItems, parentStrings }); } catch { return []; }
  }
  function recomputeDerived(uid, tree) {
    const badges = new Map();
    try {
      const found = collectTargets(tree);
      const res = host.cardStats(found.stats, { boardUid: uid });
      if (res instanceof Map) for (const [key, stat] of res) badges.set(key, stat);
    } catch { /* the check still verifies */ }
    let links = [];
    try { links = linksFromTree(uid, tree) || []; } catch { links = []; }
    derivedLive.set(uid, { stamp: null, badges, links });
    try { return packDerived(badges, links); } catch { return null; }
  }
  // PXD-1 (speed flag slicedDerived). A check that found the board unchanged marks it verified at once (its seeded
  // derived data was stored with this same stamp) and refreshes the badges and links in background parts of
  // STATS_PART cards: recomputeDerived in one part was a 5 s task on the PhD main board (1,500 cards' stats, then the
  // links query) ~20 s after every cold open. The result replaces the seeded one only when the board's page did not
  // move since the read (an edit meanwhile: the session's own reads are fresher); listeners then take it.
  const slicedDerivedOn = () => { try { return notedSpeedFlags().slicedDerived !== false; } catch { return true; } };
  const refreshDerived = (uid, tree, stamp) => {
    rederives.get(uid)?.();
    let found = null;
    let at = 0;
    let links = null;
    const badges = new Map();
    let cancel = null;
    const end = () => { if (rederives.get(uid) === cancel) rederives.delete(uid); return true; };
    cancel = sharedBgBudget().run(() => {
      try {
        if (!found) {
          try { found = collectTargets(tree); } catch { found = { stats: [] }; }
          return false;
        }
        if (at < found.stats.length) {
          try {
            const res = host.cardStats(found.stats.slice(at, at + STATS_PART), { boardUid: uid });
            if (res instanceof Map) for (const [key, stat] of res) badges.set(key, stat);
          } catch { /* the stored badges stay */ }
          at += STATS_PART;
          return false;
        }
        if (links == null) {
          try { links = linksFromTree(uid, tree) || []; } catch { links = []; }
          return false;
        }
        end();
        if (pageStampOf(uid) !== stamp) return true;
        derivedLive.set(uid, { stamp: null, badges, links });
        let packed = null;
        try { packed = packDerived(badges, links); } catch { packed = null; }
        if (modelStore?.stampOf(uid) === stamp) void modelStore.putDerived(uid, stamp, packed);
        for (const fn of [...(derivedListeners.get(uid) || [])]) {
          try { fn(); } catch (error) { console.warn("[plexus-diagram] derived listener failed", error); }
        }
        return true;
      } catch (error) {
        end();
        throw error;
      }
    }, { label: "derived", partMs: 4 });
    rederives.set(uid, cancel);
  };
  let modelStore = null;
  const unverified = new Map(); // uid -> stamp the model was read at
  const verifyListeners = new Map(); // uid -> Set(fn)
  const checks = new Map(); // uid -> cancel of the running background check
  const checkOwed = new Set(); // checks stopped by a park; they run again on resume
  const checkTimers = new Map(); // uid -> retry timer after a failed check
  const checkDelay = new Map(); // uid -> backoff before the next failed-check retry
  const keeps = new Map(); // uid -> cancel of the running model store job
  const refreshes = new Map(); // uid -> cancel of the running model refresh read
  const rederives = new Map(); // uid -> cancel of the running sliced derived refresh
  const derivedListeners = new Map(); // uid -> Set(fn) told when a sliced refresh replaced the derived data
  const CHECK_QUIET_MS = 1500;
  const CHECK_SLICE_MS = 20;
  const CHECK_BATCH = 250;
  const markVerified = (uid) => {
    if (!unverified.delete(uid)) return;
    checkOwed.delete(uid);
    const fns = verifyListeners.get(uid);
    verifyListeners.delete(uid);
    for (const fn of fns || []) {
      try { fn(); } catch (error) { console.warn("[plexus-diagram] verified listener failed", error); }
    }
  };
  // Store a consistent tree with its stamp: encoded in parts on the background budget, then one put.
  // derived undefined: compute it when the flag is on, so the next trusted open can skip prime and links.
  // null: store no derived field payload (over the cap, or the recompute failed). An object is stored as given.
  const keepModel = (uid, tree, stamp, derived) => {
    if (!modelStore || !trustOn() || !tree?.[":block/uid"] || typeof stamp !== "string") return;
    keeps.get(uid)?.();
    const enc = createTreeEncoder(tree);
    const clock = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());
    const cancel = sharedBgBudget().run((deadline) => {
      if (!enc.step(Math.max(1, deadline.timeRemaining() - 2), clock)) return false;
      if (keeps.get(uid) === cancel) keeps.delete(uid);
      const model = enc.result();
      if (model) {
        let packed = derived;
        if (packed === undefined && derivedOn()) {
          try { packed = recomputeDerived(uid, tree); } catch { packed = null; }
        }
        if (packed !== undefined) model.derived = packed;
        void modelStore.put(uid, stamp, model);
      }
      stats.modelsKept = (stats.modelsKept || 0) + 1;
      return true;
    }, { label: "model-keep", partMs: 4, firstQuiet: 1000 });
    keeps.set(uid, cancel);
  };
  // A board read in background slices: done(tree, stamp) with a consistent tree (one retry, then one whole pull).
  // prepare(tree) runs in a part of its own between the read and done. The reader stays through the accept: done
  // runs only when the page stamp did not move, the folds still match (verifyOpen), and every copied block's
  // string, order, heading and props still match. A miss is a failed take. A frozen tree is never handed to done.
  const backgroundRead = (uid, label, done, { stopIf = () => false, prepare = null } = {}) => {
    let reader = null;
    let tries = 0;
    let cancel = null;
    let got = null;
    const whole = () => {
      reader = null;
      got = null;
      const stamp = pageStampOf(uid);
      let tree = null;
      try { tree = rawPull(BOARD_PATTERN, eidKey(uid)); } catch { tree = null; }
      if (tree?.[":block/uid"] && prepare) prepare(tree);
      done(tree?.[":block/uid"] ? tree : null, stamp);
      return true;
    };
    // One retry of the sliced read, then the whole pull. The reader from the failed take is dropped.
    const mismatch = () => {
      reader = null;
      got = null;
      tries += 1;
      stats[`${label}Retries`] = (stats[`${label}Retries`] || 0) + 1;
      return tries >= 2 ? whole() : false;
    };
    const part = () => {
      if (stopIf()) return true;
      if (got) {
        if (!got.prepared && prepare) { got.prepared = true; prepare(got.tree); return false; }
        // The accept stamp pull is first, so an edit that lands on it is still unread when the compares run.
        if (!got.checked) {
          let openOk = false;
          try { openOk = pageStampOf(uid) === got.stamp && reader.verifyOpen(); } catch { openOk = false; }
          if (!openOk) return mismatch();
          got.checked = true;
        }
        let fields = "bad";
        try { fields = reader.verifyFieldsPart(); } catch { fields = "bad"; }
        if (fields === "more") return false;
        if (fields !== "ok") return mismatch();
        const { tree, stamp } = got;
        reader = null;
        got = null;
        done(tree, stamp);
        return true;
      }
      if (!reader) {
        let rootEid = null;
        try { rootEid = rawPull("[:db/id]", eidKey(uid))?.[":db/id"] ?? null; } catch { rootEid = null; }
        if (rootEid == null || typeof data.pull_many !== "function") return whole();
        reader = createSlicedRead({
          rootEid,
          pullMany: (pattern, eids) => data.pull_many(pattern, eids),
          stamp: () => pageStampOf(uid),
          clock: () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now()),
          sliceMs: CHECK_SLICE_MS,
          batch: CHECK_BATCH,
        });
      }
      if (!reader.step()) return false;
      const stamp = reader.stamp;
      const tree = reader.take();
      if (tree?.[":block/uid"] === uid) { got = { tree, stamp, prepared: false, checked: false }; return false; }
      return mismatch();
    };
    cancel = sharedBgBudget().run(part, { label, partMs: 4, firstQuiet: CHECK_QUIET_MS });
    return () => cancel?.();
  };
  const clearCheckTimer = (uid) => {
    const timer = checkTimers.get(uid);
    if (timer == null) return;
    clearTimeout(timer);
    checkTimers.delete(uid);
  };
  // A failed check left the board unverified. Run it again, after a growing wait, while the split is still
  // live and not held. A park owes the check to resume; an unmount or dispose drops it.
  const retryCheck = (uid) => {
    if (checkTimers.has(uid) || checks.has(uid) || !unverified.has(uid)) return;
    const split = splitWatches.get(uid);
    if (!split || split.disposed) return;
    if (split.held) { checkOwed.add(uid); return; }
    const delay = checkDelay.get(uid) || CHECK_QUIET_MS;
    checkDelay.set(uid, Math.min(delay * 2, 8000));
    const timer = setTimeout(() => {
      checkTimers.delete(uid);
      if (!unverified.has(uid)) return;
      const live = splitWatches.get(uid);
      if (!live || live.disposed) return;
      if (live.held) { checkOwed.add(uid); return; }
      scheduleCheck(uid);
    }, delay);
    try { timer.unref?.(); } catch { /* a fake timer has no unref */ }
    checkTimers.set(uid, timer);
  };
  // The background check of a trusted open. A parked board stops it (resume runs it again).
  const scheduleCheck = (uid) => {
    clearCheckTimer(uid);
    if (checks.has(uid) || !unverified.has(uid)) return;
    let stopped = false;
    const cancel = backgroundRead(uid, "check", (tree, stamp) => {
      checks.delete(uid);
      if (!unverified.has(uid)) return;
      if (!tree) {
        stats.checkFails = (stats.checkFails || 0) + 1;
        retryCheck(uid);
        return;
      }
      checkDelay.delete(uid);
      bigBoards.set(uid, tree);
      const split = splitWatches.get(uid);
      let changed = true;
      if (split && !split.disposed) changed = split.reseed(tree, { contents: true }) !== false;
      stats.checks = (stats.checks || 0) + 1;
      if (changed) stats.checkChanges = (stats.checkChanges || 0) + 1;
      if (!changed && derivedOn() && slicedDerivedOn() && modelStore?.stampOf(uid) === stamp) {
        markVerified(uid);
        refreshDerived(uid, tree, stamp);
        return;
      }
      // Recompute before the listeners run, so a seeded open replaces the stored links in the same turn.
      let packed;
      if (derivedOn()) {
        try { packed = recomputeDerived(uid, tree); } catch { packed = null; }
      }
      markVerified(uid);
      if (changed || modelStore?.stampOf(uid) !== stamp) keepModel(uid, tree, stamp, packed);
      else if (derivedOn()) void modelStore?.putDerived(uid, stamp, packed ?? null);
    }, {
      prepare: (tree) => absorb(uid, tree, false),
      stopIf: () => {
        if (stopped || !unverified.has(uid)) { checks.delete(uid); return true; }
        if (splitWatches.get(uid)?.held) { checks.delete(uid); checkOwed.add(uid); return true; }
        return false;
      },
    });
    checks.set(uid, () => { stopped = true; cancel(); });
  };
  const resumeCheck = (uid) => {
    if (!checkOwed.delete(uid)) return;
    scheduleCheck(uid);
  };
  const boardKeys = new Map();
  const boardPageOf = new Map();
  const pdfUrls = new Map();
  const boardCovers = new Map();
  const watchedBoards = new Map();
  // Boards of SPLIT_WATCH_MIN blocks or more: uid -> their last full pull, and the split watch while one is live.
  const bigBoards = new Map();
  const splitWatches = new Map();
  // Board uid -> the card uid open in the editor. The section watch skips a kick that is only that string.
  const editingOf = new Map();
  const editListeners = new Map();
  // Mounted cards that want their contents live: itemUid -> { n, offs: split -> release }. Kept here, not on the
  // split, so a split recreated after a keep-alive pause arms them again without the view asking.
  const contentWants = new Map();
  const edgeFingerprintOn = () => { try { return notedSpeedFlags().edgeFingerprint === true; } catch { return false; } };
  const editQuietOn = () => { try { return notedSpeedFlags().editQuiet !== false; } catch { return true; } };
  const splitWatchOn = () => { try { return notedSpeedFlags().splitWatch !== false; } catch { return true; } };
  // A card's content watch can wait: with the minute budget low, arms wait until it recovers, so openPage and writes
  // are not refused. The board's own watches never wait.
  let armTimer = null;
  const armLater = () => {
    if (armTimer != null) return;
    armTimer = setTimeout(() => {
      armTimer = null;
      for (const [key, want] of contentWants) armContent(key, want);
    }, WATCH_ARM_RETRY_MS);
    try { armTimer.unref?.(); } catch { /* a fake timer has no unref */ }
  };
  const armContent = (key, want) => {
    for (const split of splitWatches.values()) {
      if (want.offs.has(split)) continue;
      if (pacer.recent >= WATCH_ARM_LOW) { armLater(); return; }
      const off = split.watchItem(key, { pending: true });
      if (off) want.offs.set(split, off);
    }
  };
  // Idle prime parts still queued: dispose() cancels them.
  const idleHandles = new Map();
  const idleLater = (idle, fn) => {
    const key = {};
    const run = (deadline) => { idleHandles.delete(key); fn(deadline); };
    // P8 U2: the shared background budget (quiet after input, 30 ms slices) unless the speed flag is off.
    if (typeof idle === "function" && notedSpeedFlags().bgBudget !== false) idleHandles.set(key, { cancel: sharedBgBudget().idle(run, { timeout: 1500, label: "prime" }) });
    else if (typeof idle === "function") idleHandles.set(key, { idle: idle(run, { timeout: 1500 }) });
    else idleHandles.set(key, { timer: setTimeout(run, 250) });
  };
  // uid -> pull sequence number at which its last board watch was dropped.
  const unwatchedAt = new Map();
  let pullSeq = 0;
  const watchedBlocks = new Map();
  const watchedKids = new Map();
  const eidByUid = new Map();
  const eidByTitle = new Map();
  const statsCache = new Map();
  const PRIME_CHUNK = 40;
  // Card-stat targets per idle slice (~1.3 ms each on a 28k-block board).
  const STATS_CHUNK = 80;
  const STATS_PART = 20;
  const STATS_TTL_MS = 120000;
  // Idle work after an open: parts this small, until ~IDLE_SLICE_MS of a slice is used.
  // P8 U2: 30 ms slices; 60 refs were one ~42 ms part on the PhD main board.
  const IDLE_SLICE_MS = 30;
  const IDLE_RESERVE_MS = 6;
  const IDLE_REF_PART = 30;
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
  const watchSplit = (uid, cb) => {
    let slot = watchedBoards.get(uid);
    if (!slot) {
      slot = { coversRefs: false, n: 0, pages: new Map() };
      watchedBoards.set(uid, slot);
    }
    slot.n += 1;
    unwatchedAt.delete(uid);
    const sub = { fn: guardCallback("watchBoard", (tree) => cb(tree), { stats }), paused: false, missed: false, split: null };
    const attach = () => {
      const own = splitFor(uid);
      sub.split = own;
      own.subs.add(sub);
      unhold(own);
      // A held split comes back: one publish if it changed meanwhile.
      if (own.held) own.release();
      resumeCheck(uid);
      return own;
    };
    attach();
    stats.watches++;
    let active = true;
    const off = () => {
      if (!active) return;
      active = false;
      const own = sub.split;
      own.subs.delete(sub);
      // Leaving a page drops its crumb pool; the way back opens the same nested board again. With no subscriber
      // left the split is held like a parked one and goes after SPLIT_HOLD_MS.
      // A split already held (the last subscriber was parked) keeps its deadline.
      if (!own.disposed && !own.held && splitWatches.get(uid) === own && [...own.subs].every((x) => x.paused)) holdSplit(uid, own);
      stats.watches--;
      // slot.n counts live subscribers: a paused one already left it.
      if (!sub.paused) slot.n = Math.max(0, slot.n - 1);
      if (slot.n === 0 && slot.pages.size === 0) watchedBoards.delete(uid);
      if (slot.n === 0) unwatchedAt.set(uid, pullSeq);
    };
    // A parked board keeps its watches registered and quiet for up to SPLIT_HOLD_MS; resume publishes once if
    // anything changed. Past that the watches go (a parked board costs Roam a re-pull of each of them on every
    // transaction anywhere in the graph), and resume builds the split again and reads it once.
    off.pause = () => {
      if (!active || sub.paused) return;
      sub.paused = true;
      // A parked board is not watched: cache readers stop trusting it and its idle card-stat parts stop.
      slot.n = Math.max(0, slot.n - 1);
      if (slot.n === 0) unwatchedAt.set(uid, pullSeq);
      const own = sub.split;
      if (!own.disposed && [...own.subs].every((x) => x.paused)) holdSplit(uid, own);
    };
    // Throws (and stays paused) when Roam refuses the rebuild of an expired split; the caller tries again later.
    off.resume = () => {
      if (!active || !sub.paused) return;
      const live = () => {
        sub.paused = false;
        slot.n += 1;
        unwatchedAt.delete(uid);
        if (watchedBoards.get(uid) !== slot && !watchedBoards.has(uid)) watchedBoards.set(uid, slot);
      };
      let own = sub.split;
      if (own.disposed || splitWatches.get(uid) !== own) {
        // The hold expired: build the split again from a fresh read of the whole board, never from the open-time
        // seed (cards edited since then would publish their old contents).
        let fresh = null;
        try { fresh = rawPull(BOARD_PATTERN, eidKey(uid)); } catch { fresh = null; }
        if (!fresh?.[":block/uid"]) {
          own.subs.delete(sub);
          sub.missed = false;
          live();
          queueMicrotask(() => { if (active && !sub.paused) sub.fn(null); });
          return;
        }
        absorb(uid, fresh, false);
        bigBoards.set(uid, fresh);
        // A whole fresh read: a trusted open is verified by it.
        markVerified(uid);
        own.subs.delete(sub);
        own = attach();
        sub.missed = false;
        live();
        queueMicrotask(() => {
          // A mounted card's compare read may have published already.
          if (!active || sub.paused || sub.split !== own || own.tree) return;
          const tree = own.current();
          if (tree?.[":block/uid"]) absorb(uid, tree, false);
          sub.fn(tree);
        });
        return;
      }
      live();
      unhold(own);
      if (own.release()) sub.missed = false;
      resumeCheck(uid);
      if (!sub.missed) return;
      sub.missed = false;
      queueMicrotask(() => { if (active && !sub.paused && own.tree) sub.fn(own.tree); });
    };
    return off;
  };
  const unhold = (own) => {
    if (own.holdTimer != null) {
      clearTimeout(own.holdTimer);
      own.holdTimer = null;
    }
  };
  const holdSplit = (uid, own) => {
    own.hold();
    unhold(own);
    own.holdTimer = setTimeout(() => {
      own.holdTimer = null;
      if (!own.held || splitWatches.get(uid) !== own) return;
      own.dispose();
      splitWatches.delete(uid);
      for (const want of contentWants.values()) want.offs.delete(own);
    }, SPLIT_HOLD_MS);
    try { own.holdTimer.unref?.(); } catch { /* a fake timer has no unref */ }
  };
  const splitFor = (uid) => {
    let split = splitWatches.get(uid);
    if (split?.disposed) {
      splitWatches.delete(uid);
      split = null;
    }
    if (split) return split;
    const subs = new Set();
    split = createSplitWatch({
      uid,
      seed: bigBoards.get(uid),
      data: watchData,
      pull: rawPull,
      fingerprint: edgeFingerprintOn(),
      editQuiet: editQuietOn,
      deepPattern: BOARD_PATTERN,
      guard: (name, fn) => guardCallback(name, fn, { stats }),
      onEditString: (itemUid, string) => {
        const live = cache.blockOf(itemUid);
        if (live && typeof live === "object") live[":block/string"] = string;
        const set = editListeners.get(uid);
        if (!set) return;
        for (const fn of set) {
          try { fn(itemUid, string); } catch { /* session */ }
        }
      },
      onTree: (tree) => {
        if (tree?.[":block/uid"]) absorb(uid, tree, false);
        for (const sub of [...subs]) {
          // A parked subscriber gets the latest tree when it resumes.
          if (sub.paused) sub.missed = true;
          else sub.fn(tree);
        }
      },
    });
    split.subs = subs;
    splitWatches.set(uid, split);
    if (editingOf.has(uid)) split.setEditing(editingOf.get(uid));
    for (const [key, want] of contentWants) armContent(key, want);
    return split;
  };
  const notifyPages = (slot, after) => {
    for (const set of slot.pages.values()) for (const fn of set) fn(after);
  };
  // Sets row.onBoard: a block on a board (as a card or through a ref card), a page linked from a board.
  const markOnBoard = (candidates, timed) => {
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
  };

  let coverMemo = null;
  const repairedPdfBlocks = new Set();
  // Distinct urls asked recently; once a board asks for COVER_INDEX_URLS of them, covers come from coverIndex.
  let coverAsks = { at: 0, urls: new Set() };
  let coverIndex = null;
  const coverIndexNow = () => {
    const now = Date.now();
    if (coverIndex && now - coverIndex.at < coverIndex.ttl) return coverIndex;
    const t0 = Date.now();
    const pages = new Map();
    for (const row of queryRows(host, PDF_PAGES_ALL_QUERY)) {
      if (!Array.isArray(row) || typeof row[0] !== "string" || typeof row[1] !== "string" || row[1] === "") continue;
      if (!pages.has(row[0])) pages.set(row[0], []);
      pages.get(row[0]).push({ uid: row[1], title: typeof row[2] === "string" ? row[2] : "", url: row[0] });
    }
    const counts = new Map();
    for (const row of queryRows(host, PDF_PAGE_COUNTS_ALL_QUERY)) {
      if (Array.isArray(row) && typeof row[0] === "string" && Number(row[1]) > 0) counts.set(row[0], Number(row[1]));
    }
    coverIndex = { at: now, ttl: Math.max(COVER_INDEX_MIN_MS, (Date.now() - t0) * 40), pages, counts };
    noteCoverBoards();
    return coverIndex;
  };
  // P9: big boards on screen when a first frame had to read the cover index (kept per graph across reloads): their next
  // cold open reads it before live, one query per task.
  const coverBoardsKey = () => `plexus-diagram:cover-boards:${graph ?? graphName()}`;
  let coverBoards = null;
  const coverBoardList = () => {
    if (coverBoards) return coverBoards;
    try { coverBoards = JSON.parse(storage?.getItem?.(coverBoardsKey()) || "[]"); } catch { coverBoards = []; }
    if (!Array.isArray(coverBoards)) coverBoards = [];
    return coverBoards;
  };
  const noteCoverBoards = () => {
    const list = coverBoardList();
    let changed = false;
    for (const uid of watchedBoards.keys()) {
      if (!bigBoards.has(uid) || list.includes(uid)) continue;
      list.unshift(uid);
      changed = true;
    }
    if (!changed) return;
    list.length = Math.min(list.length, 20);
    try { storage?.setItem?.(coverBoardsKey(), JSON.stringify(list)); } catch { /* quota or private mode */ }
  };
  // P9: the two index reads of coverIndexNow as separate tasks (live: 83 + 56 ms on Readwisenotes; together they were
  // the first live frame's 150 ms task). part 0 reads the pages, part 1 the highlight counts and sets the index.
  let coverWarm = null;
  const coverIndexPart = (i) => {
    const now = Date.now();
    if (coverIndex && now - coverIndex.at < coverIndex.ttl) return true;
    if (i === 0 || !coverWarm) {
      const t0 = Date.now();
      const pages = new Map();
      for (const row of queryRows(host, PDF_PAGES_ALL_QUERY)) {
        if (!Array.isArray(row) || typeof row[0] !== "string" || typeof row[1] !== "string" || row[1] === "") continue;
        if (!pages.has(row[0])) pages.set(row[0], []);
        pages.get(row[0]).push({ uid: row[1], title: typeof row[2] === "string" ? row[2] : "", url: row[0] });
      }
      coverWarm = { at: now, pages, ms: Date.now() - t0 };
      return false;
    }
    const t0 = Date.now();
    const counts = new Map();
    for (const row of queryRows(host, PDF_PAGE_COUNTS_ALL_QUERY)) {
      if (Array.isArray(row) && typeof row[0] === "string" && Number(row[1]) > 0) counts.set(row[0], Number(row[1]));
    }
    // A page change between the two reads is caught by the TTL like any other index change.
    coverIndex = { at: coverWarm.at, ttl: Math.max(COVER_INDEX_MIN_MS, (coverWarm.ms + Date.now() - t0) * 40), pages: coverWarm.pages, counts };
    coverWarm = null;
    return true;
  };
  const useCoverIndex = (url) => {
    const now = Date.now();
    if (now - coverAsks.at > COVER_INDEX_MIN_MS) coverAsks = { at: now, urls: new Set() };
    coverAsks.urls.add(url);
    return coverAsks.urls.size >= COVER_INDEX_URLS || Boolean(coverIndex && now - coverIndex.at < coverIndex.ttl);
  };
  const readPdfCover = (url) => {
    if (useCoverIndex(url)) {
      const index = coverIndexNow();
      const page = pdfPagePlan(url, index.pages.get(url) || []);
      if (!page) return { ...coverModel({ url, count: 0 }), pageUid: null };
      return { ...coverModel({ title: page.title, url, count: index.counts.get(page.uid) || 0 }), pageUid: page.uid };
    }
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

  // Created / edited / by whom / linked refs / children for the rows a search is about to show, cached by uid.
  const metaCache = createMetaCache((uids) => assembleMeta(uids, {
    pullMany: (pattern, eids) => (typeof data.pull_many === "function" ? data.pull_many(pattern, eids) : eids.map((e) => rawPull(pattern, e))),
    q: (query, ...inputs) => host.q(query, ...inputs),
  }));
  // Filter browse (empty box + filters): results by filter set for 30 s, at most FILTER_BROWSE_MAX sets.
  const filterBrowseCache = new Map();
  // User name (lowercase) → user entity ids, for the created-by / edited-by clauses. Users change rarely.
  let userEids = null;
  const userIdsFor = (name) => {
    const now = Date.now();
    if (!userEids || now - userEids.at > 5 * 60000) {
      const map = new Map();
      for (const query of USER_EID_QUERIES) {
        for (const [eid, n] of host.q(query) || []) {
          if (typeof n !== "string" || eid == null) continue;
          const key = n.toLowerCase();
          if (!map.has(key)) map.set(key, []);
          if (!map.get(key).includes(eid)) map.get(key).push(eid);
        }
      }
      userEids = { at: now, map };
    }
    return userEids.map.get(String(name).toLowerCase()) || null;
  };
  // :pdf/url → highlight blocks on that Roam PDF page, all PDFs in one read, kept 30 s.
  let highlightUrls = null;
  const highlightCounts = (timed) => {
    const now = Date.now();
    if (highlightUrls && now - highlightUrls.at < FILTER_BROWSE_TTL_MS) return highlightUrls.map;
    const map = new Map();
    for (const [url, props] of timed("pdf-highlights", () => host.q(PDF_HIGHLIGHTS_QUERY))) {
      if (typeof url === "string" && hasPdfHighlight(props)) map.set(url, (map.get(url) || 0) + 1);
    }
    highlightUrls = { at: now, map };
    return map;
  };
  // Rows (cards or graph rows with a pdf string) that pass Parsed PDFs / PDFs with highlights. Parsed: the url is in the
  // local parse store (`parsedUrls`) or the block keeps a read (`plexus-reads`, one pull_many for the rest).
  const pdfKeep = (rows, { parsed = false, highlights = false, parsedUrls = null } = {}, timed) => {
    const pdfs = rows.filter((r) => libraryKind(r) === "pdf" || r?.kind === "pdf");
    if (!parsed && !highlights) return rows;
    const urlOf = (r) => r.url || pdfMacroUrl(r.string) || "";
    let marks = null;
    if (highlights) marks = highlightCounts(timed);
    let kept = highlights ? pdfs.filter((r) => (marks.get(urlOf(r)) || 0) > 0) : pdfs;
    if (parsed) {
      const local = parsedUrls instanceof Set ? parsedUrls : new Set();
      const ask = kept.filter((r) => !local.has(urlOf(r)) && r.uid);
      const reads = new Set();
      if (ask.length) {
        timed("pdf-reads", () => {
          let nodes = [];
          try { nodes = typeof data.pull_many === "function" ? data.pull_many("[:block/uid :block/props]", ask.map((r) => [":block/uid", r.uid])) || [] : []; } catch { nodes = []; }
          for (const node of nodes) {
            const props = node?.[":block/props"];
            const held = props && typeof props === "object" ? plainKeys(props)?.["plexus-reads"] : null;
            if (held && typeof held === "object" && Object.keys(held).length) reads.add(node[":block/uid"]);
          }
          return [];
        });
      }
      kept = kept.filter((r) => local.has(urlOf(r)) || reads.has(r.uid));
    }
    return kept;
  };
  // The browse list's page titles and times: one pull over every page (~80 ms in a 6.5k-page graph), kept a short while
  // so reopening the panel, switching sorts or clearing the box does not read the graph again.
  let browsePages = null;
  // One prepared copy of the caller's PDF list. A new array (panel open, board change) rebuilds it.
  // Typing passes the same array, so the strings are not scanned again.
  let pdfPrepFrom = null;
  const pdfPrep = [];
  const preparedPdfBlocks = (list) => {
    if (list === pdfPrepFrom) return pdfPrep;
    pdfPrepFrom = list;
    pdfPrep.length = 0;
    const src = Array.isArray(list) ? list : [];
    for (let i = 0; i < src.length; i += 1) {
      const row = src[i];
      const string = typeof row?.string === "string" ? row.string : "";
      const uid = row?.uid;
      if (!string || uid == null || uid === "") continue;
      const pageTitle = typeof row.pageTitle === "string" ? row.pageTitle : "";
      if (pageTitle.startsWith("roam/")) continue;
      const knownUrl = typeof row.url === "string" ? row.url : "";
      pdfPrep.push({
        kind: "block",
        blockKind: "pdf",
        uid: String(uid),
        string,
        lower: string.toLowerCase(),
        url: knownUrl || pdfMacroUrl(string),
        pageTitle,
        edited: null,
        tags: [],
        onBoard: false,
      });
    }
    return pdfPrep;
  };
  const attachMeta = (rows) => {
    const uids = rows.map((r) => r.uid).filter(Boolean);
    if (!uids.length) return rows;
    const got = metaCache.get(uids);
    for (const row of rows) { const m = got.get(row.uid); if (m) row.meta = m; }
    return rows;
  };

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
    pullBoard(uid, { light = false, deferRefs = false, prime: doPrime = true } = {}) {
      // P9: a board still showing an unverified stored model (an adopted open that was dropped, a held split taken
      // back) gets its check whatever path this pull takes.
      if (unverified.has(uid) && !checks.has(uid)) queueMicrotask(() => scheduleCheck(uid));
      // P9: a tree the cold open's preread already adopted (absorbed, its split watching since then): no read here.
      let node = null;
      let honored = false;
      let big = false;
      let found = null;
      let derivedHit = false;
      let adopted = adoptedTrees.get(uid) || null;
      if (adopted) adoptedTrees.delete(uid);
      // Every non-trusted adopt rechecks the page stamp. A card-body write moves it and leaves the split's
      // content map on the old seed, so the held tree is dropped and the board is read, as an offer was on 3.29.0.
      if (adopted && !adopted.trusted && pageStampOf(uid) !== adopted.stamp) {
        const stale = adopted.split;
        if (stale && splitWatches.get(uid) === stale) {
          unhold(stale);
          try { stale.dispose(); } catch { /* already gone */ }
          splitWatches.delete(uid);
        }
        adopted = null;
      }
      if (adopted && Date.now() - adopted.at <= OFFER_TTL_MS && splitWatches.get(uid) === adopted.split && !adopted.split.disposed) {
        node = adopted.node;
        found = adopted.found || collectTargets(node);
        big = true;
        warm.delete(uid);
        if (adopted.trusted) {
          stats.trustedOpens = (stats.trustedOpens || 0) + 1;
          scheduleCheck(uid);
          derivedHit = seedDerived(uid, adopted.stamp, adopted.derived);
        } else stats.slicedReads = (stats.slicedReads || 0) + 1;
      } else {
        if (adopted && unverified.has(uid)) scheduleCheck(uid);
        // A big board under its split watch (undo, redo, refresh): its containers again, contents as stored. The whole
        // tree plus every ref was 1.2 s on the PhD main board.
        const split = light ? splitWatches.get(uid) : null;
        if (split) {
          const tree = split.refresh();
          if (tree?.[":block/uid"]) {
            absorb(uid, tree, false);
            bigBoards.set(uid, tree);
            return tree;
          }
        }
        if (warm.has(uid)) {
          // A split is the authority for its board: the cache can hold the parent board's older copy of it, or the
          // pre-park tree of a held split. Never reseed a split from the cache.
          const own = splitWatches.get(uid);
          if (own && !own.disposed && own.tree?.[":block/uid"]) return own.tree;
          const cached = cache.blockOf(uid);
          if (cached?.[":block/uid"]) {
            // A nested board absorbed from its parent's pull is big by the same rule as a cold one: its watch must
            // be the split, not one recursive pull (a 3,641-block nested board on the PhD main board).
            if (treeSize(cached, SPLIT_WATCH_MIN) >= SPLIT_WATCH_MIN && !(own && !own.disposed)) bigBoards.set(uid, cached);
            return cached;
          }
        }
        warm.delete(uid);
        const boardEntity = eidKey(uid);
        // The structure first; the wide pull only when few blocks carry refs. A sliced read of a cold open (P8 U3)
        // stands in for the structure pull while the board's page stamp is still the one it was read at.
        let plain = null;
        const offered = offeredTrees.get(uid);
        offeredTrees.delete(uid);
        let offeredFound = null;
        let readStamp = null;
        let trustedOpen = false;
        if (offered && offered.stamp != null && Date.now() - offered.at <= OFFER_TTL_MS && pageStampOf(uid) === offered.stamp
          && (!offered.trusted || (trustOn() && splitWatchOn() && treeSize(offered.tree, SPLIT_WATCH_MIN) >= SPLIT_WATCH_MIN))) {
          plain = offered.tree;
          offeredFound = offered.found || null;
          readStamp = offered.stamp;
          trustedOpen = offered.trusted === true;
          if (trustedOpen) stats.trustedOpens = (stats.trustedOpens || 0) + 1;
          else stats.slicedReads = (stats.slicedReads || 0) + 1;
        }
        if (!plain) {
          try { plain = rawPull(BOARD_PATTERN, boardEntity); } catch { plain = null; }
          if (plain?.[":block/uid"]) markVerified(uid);
        }
        node = null;
        big = Boolean(plain?.[":block/uid"]) && treeSize(plain, SPLIT_WATCH_MIN) >= SPLIT_WATCH_MIN;
        const refBlocks = plain?.[":block/uid"] && !big ? refBlocksOf(plain, OPEN_PULL_MAX_REFS) : 0;
        if (!plain?.[":block/uid"] || (refBlocks > 0 && refBlocks <= OPEN_PULL_MAX_REFS)) {
          try { node = rawPull(OPEN_PATTERN, boardEntity); } catch { node = null; }
        }
        honored = Boolean(node?.[":block/uid"] && hasRefs(node));
        if (!node?.[":block/uid"]) {
          node = plain;
          honored = false;
        }
        if (!node?.[":block/uid"]) return null;
        absorb(uid, node, honored);
        if (big) {
          bigBoards.set(uid, node);
          splitWatches.get(uid)?.reseed(node);
          if (trustedOpen) {
            unverified.set(uid, readStamp);
            scheduleCheck(uid);
            derivedHit = seedDerived(uid, readStamp, offered?.derived);
          } else if (node === plain && modelStore && trustOn()) {
            // A whole pull: same task, so the stamp read now is the one the tree was read at.
            readStamp ??= pageStampOf(uid);
            if (readStamp && modelStore.stampOf(uid) !== readStamp) keepModel(uid, plain, readStamp);
          }
        } else bigBoards.delete(uid);

        found = offeredFound && node === plain ? offeredFound : collectTargets(node);
      }
      const pullRefs = () => {
        if (!honored && (found.uids.length || found.titles.length)) {
          for (const entity of pullMany(found.uids, found.titles)) addEntity(uid, entity);
        }
      };
      // The same reads in slices for idle time (PhD main board: 1,000 refs were one 0.54 s task).
      // One level at a time. The idle sizer picks how many nodes; a missing count stays at OUTLINE_BATCH.
      // A page with a deep outline was one recursive REF_BODY (77–199 ms). The synchronous pullRefs() above stays that one pull.
      let refAsm = null;
      const pullLevel = (pattern, entities) => {
        if (typeof data.pull_many === "function") {
          try {
            const many = data.pull_many(pattern, entities);
            if (Array.isArray(many)) return many;
          } catch { /* one query of this level */ }
        }
        const uids = [];
        const titles = [];
        for (const entity of entities || []) {
          if (!Array.isArray(entity)) continue;
          if (entity[0] === ":node/title") titles.push(entity[1]);
          else if (entity[0] === ":block/uid") uids.push(entity[1]);
        }
        let rows = [];
        try {
          if (uids.length && titles.length) {
            rows = unpackPulls(host.q(
              `[:find (pull ?e ${pattern}) :in $ [?uid ...] [?title ...] :where (or [?e :block/uid ?uid] [?e :node/title ?title])]`,
              uids, titles,
            ));
          } else if (uids.length) {
            rows = unpackPulls(host.q(
              `[:find (pull ?e ${pattern}) :in $ [?uid ...] :where [?e :block/uid ?uid]]`,
              uids,
            ));
          } else if (titles.length) {
            rows = unpackPulls(host.q(
              `[:find (pull ?e ${pattern}) :in $ [?title ...] :where [?e :node/title ?title]]`,
              titles,
            ));
          }
        } catch { rows = []; }
        const byUid = new Map();
        const byTitle = new Map();
        for (const node of rows) {
          if (typeof node?.[":block/uid"] === "string") byUid.set(node[":block/uid"], node);
          if (typeof node?.[":node/title"] === "string") byTitle.set(node[":node/title"], node);
        }
        return entities.map((entity) => {
          if (!Array.isArray(entity)) return null;
          return entity[0] === ":node/title" ? (byTitle.get(entity[1]) || null) : (byUid.get(entity[1]) || null);
        });
      };
      const pullRefsPart = (n) => {
        if (honored) return true;
        if (!found.uids.length && !found.titles.length) return true;
        const asked = n == null ? OUTLINE_BATCH : Math.max(1, Math.floor(Number(n)) || 1);
        if (!refAsm) {
          refAsm = createOutlineAssembler({ pullMany: pullLevel, batch: OUTLINE_BATCH });
          refAsm.addRoots(found.uids, found.titles);
          if (refAsm.pending() === 0) return true;
          if (refAsm.start(asked) !== true) return false;
        } else if (refAsm.step(asked) !== true) return false;
        for (const entity of refAsm.entities()) addEntity(uid, entity);
        return true;
      };
      // A keep-alive catch-up already shows its cards: their refs are read again in the first idle slice
      // (PhD main board: 1,000 refs, 0.54 s of the reattach task).
      // A big board's first open reads them in idle slices too (PhD main board: 0.64 s inside the open).
      const refsLater = light && (deferRefs || big);
      if (!refsLater) pullRefs();
      boardCovers.set(uid, honored);
      // A keep-alive catch-up is light: the board shows at once. Badge and linked-ref
      // reads run when the browser is idle.
      const prime = () => {
        try { fetchLinked(found.titles); } catch { /* a later linkedRefs ask reads Roam */ }
        dropStats(uid);
        if (!found.stats.length) return;
        // A normal board reads every stat in this call, as 3.27.0 did: each call pays four datalog queries of
        // ~40-55 ms whatever its size, so idle chunks on Parse Lab were 50-134 ms tasks under the first pans.
        const chunk = statsInParts(node, found.stats) ? STATS_CHUNK : found.stats.length;
        try { host.cardStats(found.stats.slice(0, chunk), { boardUid: uid }); } catch { /* badges ask again */ }
        // The rest of a big board's stats in idle slices.
        const idle = globalThis.requestIdleCallback;
        const later = (fn) => idleLater(idle, fn);
        const pulledAt = pullSeq;
        let si = chunk;
        const clock = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());
        // Parts of STATS_PART while the idle slice lasts, one part at least. A whole chunk per callback (PhD main
        // board targets: 20 of them can take 150 ms) ran back to back under a pan on another board: 50-100 ms frames.
        const step = (deadline) => {
          if (si >= found.stats.length || (unwatchedAt.has(uid) && unwatchedAt.get(uid) >= pulledAt)) return;
          const t0 = clock();
          // A callback past its timeout runs in a busy window (a pan): one part only.
          const left = () => (deadline?.didTimeout ? 0 : Math.min(IDLE_SLICE_MS - (clock() - t0), typeof deadline?.timeRemaining === "function" ? deadline.timeRemaining() : Infinity));
          do {
            try { host.cardStats(found.stats.slice(si, si + STATS_PART), { boardUid: uid }); } catch { /* badges ask again */ }
            si += STATS_PART;
          } while (si < found.stats.length && left() > IDLE_RESERVE_MS);
          later(step);
        };
        if (si < found.stats.length) later(step);
      };
      // prime: false (card-chip cache, chip and board-row previews, thumbnails): structure and refs only; badges and
      // linked refs are asked for on demand. A preview of the PhD main board on another board primed its stats in idle
      // parts under that board's gestures (C. botulinum: 53-146 ms frames on fit, hover and select).
      if (!light) { if (doPrime && !derivedHit) prime(); } else {
        // Linked refs stay in chunks of PRIME_CHUNK. Card stats are one pull:
        // 300 cards measured about 19 ms, inside one idle slice.
        const idle = globalThis.requestIdleCallback;
        const later = (fn) => idleLater(idle, fn);
        // A big board reads linked refs and card stats for the cards on screen only (one part of 10 linked-ref titles
        // was ~0.5 s on the PhD main board). A stored derived hit skips both; outline refs still run above.
        const titles = (big || derivedHit) ? [] : found.titles;
        const targets = (big || derivedHit) ? [] : found.stats;
        // The same gate as a full open: many items read in parts, not one call.
        const statsPart = statsInParts(node, targets) ? STATS_CHUNK : Infinity;
        const pulledAt = ++pullSeq;
        let ti = 0;
        let si = 0;
        let statsDone = false;
        let refsDone = !refsLater;
        let dropped = false;
        const refSizer = createPartSizer({ max: IDLE_REF_PART, start: 4 });
        const clock = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());
        // Small parts until the idle slice is nearly spent (PhD main board: 80 card stats or all refs per slice were
        // 0.2-0.6 s tasks). One part always runs, so a busy window still makes progress.
        const step = (deadline) => {
          // The board's last watch went away after this pull (closed, parked): skip the reads.
          if (unwatchedAt.has(uid) && unwatchedAt.get(uid) >= pulledAt) return;
          const t0 = clock();
          const left = () => Math.min(IDLE_SLICE_MS - (clock() - t0), typeof deadline?.timeRemaining === "function" && !deadline.didTimeout ? deadline.timeRemaining() : Infinity);
          do {
            if (!refsDone) {
              // P8 U2: as many refs as fit the slice at their measured cost (30 at once were 60-190 ms parts).
              const n = refSizer.size(left() - IDLE_RESERVE_MS);
              const r0 = clock();
              try { refsDone = pullRefsPart(n); } catch { refsDone = true; /* cards read their refs on demand */ }
              refSizer.note(n, clock() - r0);
              continue;
            }
            if (!dropped) { dropped = true; if (!derivedHit) dropStats(uid); }
            if (ti < titles.length) {
              try { fetchLinked(titles.slice(ti, ti + PRIME_CHUNK)); } catch { /* a later linkedRefs ask reads Roam */ }
              ti += PRIME_CHUNK;
            } else if (!statsDone) {
              const part = targets.slice(si, si + statsPart);
              si = Math.min(targets.length, si + statsPart);
              if (si >= targets.length) statsDone = true;
              if (part.length) {
                try { host.cardStats(part, { boardUid: uid }); } catch { /* badges ask again */ }
              }
            } else break;
          } while (left() > IDLE_RESERVE_MS);
          if (!refsDone || ti < titles.length || !statsDone) later(step);
        };
        later(step);
      }
      return node;
    },

    // P8 U3. A cold open's board read in short tasks: null when pullBoard would not read Roam whole (warm cache, a
    // split already holds the board), when pull_many or the page stamp is missing. reader.step() does one task's
    // worth and is true when finished; a consistent result is offered to the next pullBoard of this board.
    // P9: with a stored model read at the page's current stamp (speed flag trustSnapshot, big boards with the split
    // watch), the reader loads and decodes that model instead (reader.waiting: a promise while IndexedDB answers) and
    // offers it as trusted; any miss on the way falls back to the sliced read.
    prereadBoard(uid, opts = {}) {
      const id = String(uid ?? "");
      if (!id || typeof data.pull_many !== "function") return null;
      if (warm.has(id) || splitWatches.has(id)) return null;
      const stored = opts.trust !== false && modelStore && trustOn() && splitWatchOn() ? modelStore.stampOf(id) : null;
      const reader = stored && pageStampOf(id) === stored ? host.trustedReader(id, stored, opts) : host.slicedReader(id, opts);
      if (!reader) return null;
      // After the read, before the acquire, each in tasks of their own: the props of the board's block refs (the model
      // build reads them one pull each: 35 ms of the acquire on the PhD main board), and, for a board whose first live
      // frame needed the cover index, that index (one query per task).
      const covers = Number(opts.covers) >= COVER_INDEX_URLS || coverBoardList().includes(id);
      let stage = "read";
      let propAt = 0;
      let coverPart = 0;
      return new Proxy(reader, {
        get(target, key) {
          if (key === "phase") return stage === "read" ? target.phase : stage;
          if (key === "waiting") return stage === "read" ? target.waiting : null;
          if (key !== "step") return typeof target[key] === "function" ? target[key].bind(target) : target[key];
          return () => {
            if (stage === "read") {
              if (!target.step()) return false;
              stage = "props";
            }
            if (stage === "props") {
              const uids = adoptedTrees.get(id)?.found?.uids || [];
              if (propAt < uids.length) {
                try { propAt = primePropsPart(uids, propAt, PRIME_PROPS_BATCH); } catch { propAt = uids.length; }
                return false;
              }
              stage = "covers";
              if (!covers) return true;
            }
            let done = true;
            try { done = coverIndexPart(coverPart); } catch { done = true; }
            coverPart += 1;
            return done || coverPart > 1;
          };
        },
      });
    },

    trustedReader(id, stamp, opts = {}) {
      const clock = opts.clock || (() => (globalThis.performance?.now ? globalThis.performance.now() : Date.now()));
      const sliceMs = Number(opts.sliceMs) > 0 ? Number(opts.sliceMs) : SLICED_SLICE_MS;
      let phase = "load";
      let inner = null;
      let decoder = null;
      let tree = null;
      let walk = null;
      let derivedRaw = null;
      let cancelled = false;
      let ms = 0;
      const fallback = () => {
        stats.trustMisses = (stats.trustMisses || 0) + 1;
        inner = host.slicedReader(id, opts);
        phase = inner ? "sliced" : "failed";
      };
      let waiting = modelStore.load(id).then((model) => {
        waiting = null;
        if (cancelled) return;
        if (!model || model.stamp !== stamp) { fallback(); return; }
        derivedRaw = model.derived ?? null;
        decoder = createTreeDecoder(model);
        phase = "decode";
      }, () => {
        waiting = null;
        if (!cancelled) fallback();
      });
      return {
        get phase() { return inner ? inner.phase : phase; },
        get trusted() { return !inner; },
        get waiting() { return inner ? null : waiting; },
        get calls() { return inner ? inner.calls : 0; },
        get ms() { return inner ? inner.ms : ms; },
        step() {
          if (cancelled || phase === "failed" || phase === "done") return true;
          if (inner) return inner.step();
          if (waiting) return false;
          if (phase === "adopt") {
            phase = "done";
            if (opts.adopt !== false) adoptOffer(id);
            return true;
          }
          const t0 = clock();
          try {
            if (phase === "decode") {
              if (!decoder.step(sliceMs, clock)) return false;
              tree = decoder.result();
              decoder = null;
              if (tree?.[":block/uid"] !== id) { tree = null; fallback(); return false; }
              walk = createTargetsWalk(tree);
              phase = "targets";
              if (clock() - t0 >= sliceMs) return false;
            }
            if (!walk.step(Math.max(1, sliceMs - (clock() - t0)), clock)) return false;
            // The stamp once more right before the offer (pullBoard checks it again).
            if (pageStampOf(id) !== stamp) { tree = null; fallback(); return false; }
            offeredTrees.set(id, { tree, found: walk.result(), stamp, at: Date.now(), trusted: true, derived: derivedRaw });
            tree = null;
            walk = null;
            phase = "adopt";
            return false;
          } finally {
            ms += clock() - t0;
          }
        },
        cancel() {
          cancelled = true;
          inner?.cancel();
          offeredTrees.delete(id);
          adoptedTrees.delete(id);
        },
      };
    },

    slicedReader(id, opts = {}) {
      let rootEid = null;
      try { rootEid = rawPull("[:db/id]", eidKey(id))?.[":db/id"] ?? null; } catch { rootEid = null; }
      if (rootEid == null || pageStampOf(id) == null) return null;
      const reader = createSlicedRead({
        rootEid,
        pullMany: (pattern, eids) => data.pull_many(pattern, eids),
        stamp: () => pageStampOf(id),
        clock: () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now()),
        ...opts,
      });
      const step = reader.step;
      const clock = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());
      const sliceMs = Number(opts.sliceMs) > 0 ? Number(opts.sliceMs) : SLICED_SLICE_MS;
      // After the read: the open's ref and stat targets (collectTargets) in the same slices, so the acquire skips it.
      let tree = null;
      let walk = null;
      let offered = false;
      return {
        get phase() { return offered ? "adopt" : walk ? "targets" : reader.phase; },
        get calls() { return reader.calls; },
        get ms() { return reader.ms; },
        step() {
          // P9: a big board's offer is taken in by its own task (absorb, split watch) before the acquire.
          if (offered) {
            offered = false;
            walk = null;
            if (opts.adopt !== false) adoptOffer(id);
            return true;
          }
          if (!walk) {
            const done = step();
            if (!done) return false;
            tree = reader.take();
            if (tree?.[":block/uid"] !== id) return true;
            walk = createTargetsWalk(tree);
            return false;
          }
          if (!walk.step(sliceMs, opts.clock || clock)) return false;
          // Folds do not move the page stamp that pullBoard checks: read them again right before the offer.
          if (!reader.verifyOpen()) { tree = null; return true; }
          offeredTrees.set(id, { tree, found: walk.result(), stamp: reader.stamp, at: Date.now() });
          tree = null;
          offered = true;
          return false;
        },
        cancel() { reader.cancel(); offeredTrees.delete(id); adoptedTrees.delete(id); },
      };
    },

    // Hover warm of the session cache. No pull watch. A uid already in blockOf is not read again:
    // pullBoard drops the board root from its warm set, and a hover must not spend that read.
    // A hover prefetch reads the structure only: badges, linked refs and card stats wait for the open (a full
    // pull of the PhD main board primed ~1,000 refs and 1,500 card stats for a board that may never open).
    prefetchBoard(uid) {
      const id = String(uid ?? "");
      if (!id) return null;
      const cached = cache.blockOf(id);
      if (cached?.[":block/uid"]) return cached;
      return host.pullBoard(id, { light: true, deferRefs: true });
    },

    // One unwatched read of a page by its title. A failed pull throws, so a caller can tell it from a missing page.
    pullTitle(pattern, title) {
      if (typeof pattern !== "string" || pattern === "" || typeof title !== "string" || !title) return null;
      const res = pull(pattern, [":node/title", title]);
      return res && typeof res === "object" ? res : null;
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

    // One datalog pull for many entities. A missing pull_many falls back to one pull each.
    // Used for arrow homes: never a `:in $ [?u ...]` query.
    pullMany(pattern, uids) {
      const ids = [...new Set((uids || []).filter((id) => typeof id === "string" && id))];
      if (!ids.length || typeof pattern !== "string" || pattern === "") return [];
      const entities = ids.map((id) => eidKey(id));
      try {
        const res = typeof data.pull_many === "function"
          ? data.pull_many(pattern, entities)
          : entities.map((entity) => rawPull(pattern, entity));
        return Array.isArray(res) ? res.filter(Boolean) : [];
      } catch {
        return [];
      }
    },

    // The view's editing card. A split that is not up yet reads this when it is created.
    noteEditing(boardUid, itemUid) {
      const id = String(boardUid ?? "");
      if (!id) return;
      const next = typeof itemUid === "string" && itemUid ? itemUid : null;
      if (next) editingOf.set(id, next);
      else editingOf.delete(id);
      try { splitWatches.get(id)?.setEditing(next); } catch { /* split */ }
    },

    followEditString(boardUid, fn) {
      const id = String(boardUid ?? "");
      if (!id || typeof fn !== "function") return () => {};
      let set = editListeners.get(id);
      if (!set) {
        set = new Set();
        editListeners.set(id, set);
      }
      set.add(fn);
      return () => {
        set.delete(fn);
        if (!set.size && editListeners.get(id) === set) editListeners.delete(id);
      };
    },

    watchBoard(uid, cb) {
      const covers = boardCovers.get(uid) === true;
      if (!covers && bigBoards.has(uid) && splitWatchOn()) return watchSplit(uid, cb);
      const pattern = covers ? OPEN_PATTERN : BOARD_PATTERN;
      let slot = watchedBoards.get(uid);
      if (!slot) {
        slot = { coversRefs: covers, n: 0, pages: new Map() };
        watchedBoards.set(uid, slot);
      } else if (covers) slot.coversRefs = true;
      slot.n += 1;
      unwatchedAt.delete(uid);
      const entity = watchEntity(uid);
      const wrapped = guardCallback("watchBoard", (before, after) => {
        // K6. Roam's PDF reader writes its page into the PDF block's :pdf-settings on every page change; a board
        // that holds that PDF hears it through its refs. Plexus never reads it, so that alone repaints nothing.
        if (covers && before && after && sameButReaderState(before, after)) return;
        if (after?.[":block/uid"]) absorb(uid, after, hasRefs(after));
        cb(after);
        if (covers) notifyPages(slot, after);
      }, { stats });
      watchData.addPullWatch(pattern, entity, wrapped);
      stats.watches++;
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        watchData.removePullWatch(pattern, entity, wrapped);
        stats.watches--;
        slot.n = Math.max(0, slot.n - 1);
        if (slot.n === 0 && slot.pages.size === 0) watchedBoards.delete(uid);
        if (slot.n === 0) unwatchedAt.set(uid, pullSeq);
      };
    },

    // A mounted card on a big board keeps its contents live (the board's own watches stop at the cards).
    // A no-op on other boards: their one board watch already covers every card's contents.
    // A card the optimistic model mounted before Roam's echo is armed when a split sees it; a split recreated after
    // a keep-alive pause arms every mounted card again.
    watchContent(itemUid) {
      const key = String(itemUid ?? "");
      if (!key) return () => {};
      let want = contentWants.get(key);
      if (!want) {
        want = { n: 0, offs: new Map() };
        contentWants.set(key, want);
        armContent(key, want);
      }
      want.n += 1;
      let on = true;
      return () => {
        if (!on) return;
        on = false;
        want.n -= 1;
        if (want.n > 0 || contentWants.get(key) !== want) return;
        contentWants.delete(key);
        for (const off of want.offs.values()) { try { off(); } catch { /* already gone */ } }
      };
    },
    // P9. The stored models (src/host/model-store.js) this host reads trusted opens from and keeps fresh reads in.
    useModelStore(store) { modelStore = store || null; },
    // True while a board that went live from a stored model has not been read again: nothing destructive may act on
    // what it shows. onBoardVerified(uid, fn) calls fn once when that read lands (at once when already verified).
    boardUnverified(uid) { return unverified.has(String(uid ?? "")); },
    // Stored badge counts and derived links for a trusted hit, or null when the flag is off or this open had none.
    storedDerived(uid) {
      if (!derivedOn()) return null;
      const live = derivedLive.get(String(uid ?? ""));
      if (!live) return null;
      return { badges: live.badges, links: live.links };
    },
    onBoardVerified(uid, fn) {
      const id = String(uid ?? "");
      if (!unverified.has(id)) { try { fn(); } catch { /* listener */ } return () => {}; }
      let set = verifyListeners.get(id);
      if (!set) { set = new Set(); verifyListeners.set(id, set); }
      set.add(fn);
      return () => { set.delete(fn); };
    },
    // PXD-1: fn runs each time a sliced refresh replaced the board's derived badges and links. Returns off().
    onDerivedRefreshed(uid, fn) {
      const id = String(uid ?? "");
      let set = derivedListeners.get(id);
      if (!set) { set = new Set(); derivedListeners.set(id, set); }
      set.add(fn);
      return () => { set.delete(fn); if (!set.size && derivedListeners.get(id) === set) derivedListeners.delete(id); };
    },
    // After a change settled (the snapshot capture): a big board whose stored model is older than its page is read
    // again in background slices and stored. Not while it is unverified or parked.
    refreshModel(uid) {
      const id = String(uid ?? "");
      if (!modelStore || !trustOn() || !id || refreshes.has(id) || unverified.has(id) || !bigBoards.has(id)) return false;
      const split = splitWatches.get(id);
      if (!split || split.held || split.disposed) return false;
      const now = pageStampOf(id);
      if (!now || modelStore.stampOf(id) === now) return false;
      const cancel = backgroundRead(id, "refresh", (tree, stamp) => {
        refreshes.delete(id);
        if (tree && stamp) keepModel(id, tree, stamp);
      }, { stopIf: () => (splitWatches.get(id)?.held || !splitWatches.has(id) ? (refreshes.delete(id), true) : false) });
      refreshes.set(id, cancel);
      return true;
    },
    // Unload / teardown: every pull watch this host registered goes now, with every hold, arm and sweep timer.
    // Held splits would otherwise keep Roam re-pulling them on every transaction for SPLIT_HOLD_MS after unload.
    dispose() {
      if (armTimer != null) { clearTimeout(armTimer); armTimer = null; }
      for (const timer of checkTimers.values()) clearTimeout(timer);
      checkTimers.clear();
      checkDelay.clear();
      for (const jobs of [checks, keeps, refreshes, rederives]) {
        for (const cancel of jobs.values()) { try { cancel(); } catch { /* done */ } }
        jobs.clear();
      }
      verifyListeners.clear();
      derivedListeners.clear();
      for (const h of idleHandles.values()) {
        if (h.timer != null) clearTimeout(h.timer);
        else if (h.cancel) h.cancel();
        else try { globalThis.cancelIdleCallback?.(h.idle); } catch { /* already ran */ }
      }
      idleHandles.clear();
      for (const own of splitWatches.values()) {
        unhold(own);
        own.dispose();
      }
      splitWatches.clear();
      for (const want of contentWants.values()) want.offs.clear();
      for (const [cb, list] of [...registered]) {
        for (const [pattern, entity] of [...list]) {
          try { watchData.removePullWatch(pattern, entity, cb); } catch { /* already gone */ }
        }
      }
      registered.clear();
      watchedBlocks.clear();
      watchedKids.clear();
    },

    splitStats(uid) {
      return splitWatches.get(uid)?.stats() ?? null;
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
        watchData.addPullWatch(BLOCK_WATCH_PATTERN, entity, wrapped);
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
        watchData.removePullWatch(BLOCK_WATCH_PATTERN, slot.entity, slot.wrapped);
        stats.watches--;
      };
    },

    // One shared pull watch per parent uid for its children and their order. cb gets no arguments worth reading:
    // the caller reads the level again (outlineKids). Released with the last caller.
    watchChildren(uid, cb) {
      const id = String(uid ?? "");
      if (!id || typeof cb !== "function") return () => {};
      cb = guardCallback("watchChildren", cb, { stats });
      let slot = watchedKids.get(id);
      if (!slot) {
        const entity = watchEntity(id);
        const subs = [];
        const wrapped = guardCallback("watchChildren", () => {
          for (const token of subs.slice()) if (token.on) token.cb();
        }, { stats });
        slot = { entity, wrapped, subs };
        watchData.addPullWatch(CHILDREN_WATCH_PATTERN, entity, wrapped);
        watchedKids.set(id, slot);
        stats.watches++;
      }
      const token = { cb, on: true };
      slot.subs.push(token);
      return () => {
        if (!token.on) return;
        token.on = false;
        const i = slot.subs.indexOf(token);
        if (i >= 0) slot.subs.splice(i, 1);
        if (slot.subs.length > 0 || watchedKids.get(id) !== slot) return;
        watchedKids.delete(id);
        watchData.removePullWatch(CHILDREN_WATCH_PATTERN, slot.entity, slot.wrapped);
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

    // One outline level per parent (page or block): Map(parentUid -> [{ uid, string, open, order }]). One pull_many
    // for the whole level; "Fold queries on this page" walks only the open part of a page with it.
    outlineKids(parentUids) {
      const out = new Map();
      const ids = [...new Set((parentUids || []).filter((id) => typeof id === "string" && id))];
      if (!ids.length) return out;
      let res = null;
      try {
        res = typeof data.pull_many === "function"
          ? data.pull_many(OUTLINE_KIDS_PATTERN, ids.map(eidKey))
          : ids.map((id) => rawPull(OUTLINE_KIDS_PATTERN, eidKey(id)));
      } catch { res = null; }
      if (!Array.isArray(res)) return out;
      for (const node of res) {
        const id = node?.[":block/uid"];
        if (typeof id !== "string") continue;
        const kids = Array.isArray(node[":block/children"]) ? node[":block/children"] : [];
        out.set(id, kids.map((k) => ({
          uid: k?.[":block/uid"],
          string: typeof k?.[":block/string"] === "string" ? k[":block/string"] : "",
          open: k?.[":block/open"] !== false,
          order: Number.isFinite(k?.[":block/order"]) ? k[":block/order"] : 0,
        })).filter((k) => typeof k.uid === "string" && k.uid));
      }
      return out;
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

    // PXD-4: the outline a page card's preview paints before any card of that page mounted this session: the page as
    // the board's ref read left it in the session cache. Never reads Roam; null when the page is not cached.
    cachedPageOutline(title, limit = 48) {
      const node = cache.pageOf(String(title ?? ""));
      if (!node?.[":block/uid"]) return null;
      return { uid: node[":block/uid"], exists: true, blocks: previewTree(node, 8, { left: limit }) };
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
      watchData.addPullWatch(BOARD_PATTERN, entity, wrapped);
      stats.pageWatches++;
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        watchData.removePullWatch(BOARD_PATTERN, entity, wrapped);
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
      const pattern = "[:block/uid :node/title {(limit :block/children nil) [:block/uid :block/string :block/order]}]";
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
      await mutate(() => data.page.create({ page: { title: name } }));
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
      await mutate(() => data.page.update({ page: { uid, title: newTitle } }));
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
      // A read-ahead answers once (the model build's first ask), then Roam again.
      const primed = primedProps.get(uid);
      if (primed) primedProps.delete(uid);
      if (primed && Date.now() - primed.at <= PRIMED_PROPS_MS) { res = primed.res; stats.primedProps = (stats.primedProps || 0) + 1; }
      else {
        try { res = pull(BLOCK_PROPS_PATTERN, eidKey(uid)); } catch { return null; }
      }
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

    async createBlock({ parentUid, order = "last", uid, string = "", props, open, viewType, heading, textAlign } = {}) {
      const id = uid ?? api.util.generateUID();
      const block = { uid: id, string };
      if (props !== undefined) block.props = plainKeys(props);
      if (open !== undefined) block.open = open;
      if (heading) block.heading = heading;
      if (textAlign) block["text-align"] = textAlign;
      if (viewType) block["children-view-type"] = viewType;
      stats.writes++;
      await mutate(() => data.block.create({ location: { "parent-uid": parentUid, order }, block }));
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
      const result = await mutate(() => fn({
        location: { "parent-uid": parent, order },
        "markdown-string": String(markdown ?? ""),
      }));
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
      try { res = rawPull("[:block/uid {(limit :block/children nil) ...} :block/string :block/order]", eidKey(id)); } catch { return null; }
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

    // Date.now() of this host's last write, undo or redo (-Infinity before any).
    lastWriteAt() {
      return lastWriteAt;
    },

    // First line of a block's text, or a page's title. Empty when the uid is unknown.
    blockLabel(uid) {
      const id = String(uid ?? "");
      if (!id) return "";
      let res = null;
      try { res = rawPull("[:block/string :node/title]", eidKey(id)); } catch { return ""; }
      const text = typeof res?.[":node/title"] === "string" ? res[":node/title"] : typeof res?.[":block/string"] === "string" ? res[":block/string"] : "";
      return text.split("\n")[0].trim();
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
      await mutate(() => data.block.update({ block: { uid, string } }));
      noteWrite("update");
      forgetUid(uid);
    },

    async updateProps(uid, plexus) {
      forgetUid(uid);
      const merged = mergePropsForWrite(host.pullProps(uid), plexus);
      stats.writes++;
      await mutate(() => data.block.update({ block: { uid, props: merged } }));
      noteWrite("update");
    },

    // Notes kept reads on a PDF block. Only the `plexus-reads` prop changes; every other prop stays.
    async updateReads(uid, reads) {
      forgetUid(uid);
      const merged = { ...plainKeys(host.pullProps(uid)), "plexus-reads": plainKeys(reads) };
      stats.writes++;
      await mutate(() => data.block.update({ block: { uid, props: merged } }));
      noteWrite("update");
    },

    async moveBlock(uid, parentUid, order = "last") {
      stats.writes++;
      await mutate(() => data.block.move({ location: { "parent-uid": parentUid, order }, block: { uid } }));
      noteWrite("move");
      forgetUid(uid);
    },

    async deleteBlock(uid) {
      stats.writes++;
      await mutate(() => data.block.delete({ block: { uid } }));
      noteWrite("delete");
      forgetUid(uid);
    },

    async setOpen(uid, open) {
      stats.writes++;
      await mutate(() => data.block.update({ block: { uid, open } }));
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

    // Closes the open group as a chunk now and returns a function that opens a fresh one with the same label. A long
    // wait between batches (the sync hold) is outside any undo group: another session's writes made meanwhile are
    // their own steps, and invalidateUndo works. No-op with no group open.
    // Writes in the open group's current chunk (0 with no group open).
    groupWrites() {
      return openGroup ? openGroup.n : 0;
    },

    suspendGroup() {
      const done = openGroup;
      if (!done) return () => {};
      openGroup = null;
      closeChunk(done);
      return () => { if (!openGroup) openGroup = { n: 0, kinds: [], label: done.label || "" }; };
    },

    // The open group becomes ONE entry that undoes and redoes through its own callbacks ({ undo, redo }, async),
    // not through a count of Roam's native undo steps (one Plexus write can be more than one native entry).
    // null drops it again: a transaction that failed midway closes as a native chunk of the writes that ran.
    // A second custom entry is ignored: a nested writer must not replace the inverse that already covers this group.
    setCustomUndo(entry) {
      if (!openGroup) return;
      if (!entry) { delete openGroup.custom; return; }
      if (openGroup.custom) return;
      if (typeof entry.undo === "function" && typeof entry.redo === "function") openGroup.custom = entry;
    },

    // A file upload does not pass through noteWrite. A group that only uploaded would be dropped.
    noteGroupedWrite(kind) {
      noteWrite(typeof kind === "string" && kind ? kind : "upload");
    },

    async deletePage(uid) {
      stats.writes++;
      await mutate(() => data.page.delete({ page: { uid } }));
      noteWrite("delete");
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
      if (!entry && nativeFloor) return;
      if (entry?.custom) {
        silent = true;
        try { await entry.custom.undo(); } catch (err) { undoLog.push(entry); throw err; } finally { silent = false; lastWriteAt = Date.now(); }
        undoLog.length = 0;
        redoLog.length = 0;
        redoLog.push(entry);
        nativeFloor = true;
        return;
      }
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
      if (!entry && nativeFloor) return;
      if (entry?.custom) {
        silent = true;
        try { await entry.custom.redo(); } catch (err) { redoLog.push(entry); throw err; } finally { silent = false; lastWriteAt = Date.now(); }
        undoLog.length = 0;
        redoLog.length = 0;
        undoLog.push(entry);
        nativeFloor = true;
        return;
      }
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
      nativeFloor = false;
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

    // The derived-link rows of linksQuery() for `targets`, without its join: the sources that ref a target come from
    // the refs index, then one pull_many of their page and parents, filtered here. Same rows as the datalog (live MAIN:
    // 34-61 ms per 120 targets instead of 762-1,294 ms). `eids` is a Set of the board's card eids. Each row carries the
    // source's parent string fifth (null at the top of a page), so the caller needs no parentString read.
    linkRows(boardEid, eids, targets) {
      if (typeof data.pull_many !== "function") return host.q(linksQuery(), boardEid, [...eids], targets) || [];
      const pairs = host.q(LINK_REFS_QUERY, targets) || [];
      if (!pairs.length) return [];
      const srcs = [...new Set(pairs.map((p) => p[1]))];
      const info = new Map();
      for (const n of data.pull_many(LINK_SRC_PATTERN, srcs) || []) if (n?.[":db/id"] != null) info.set(n[":db/id"], n);
      const seen = new Set();
      const rows = [];
      for (const [b, src] of pairs) {
        const n = info.get(src);
        if (!n || src === boardEid) continue;
        const su = n[":block/uid"];
        const ss = n[":block/string"];
        if (typeof su !== "string" || typeof ss !== "string") continue;
        const parents = Array.isArray(n[":block/parents"]) ? n[":block/parents"].map((p) => p?.[":db/id"]) : [];
        if (parents.includes(boardEid)) continue;
        const up = n[":block/_children"];
        const first = Array.isArray(up) ? up[0] : up;
        const ps = typeof first?.[":block/string"] === "string" ? first[":block/string"] : null;
        for (const a of [n[":block/page"]?.[":db/id"], ...parents, src]) {
          if (a == null || a === b || !eids.has(a)) continue;
          const key = `${a}|${b}|${su}`;
          if (seen.has(key)) continue;
          seen.add(key);
          rows.push([a, b, su, ss, ps]);
        }
      }
      return rows;
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

    // The PDF a `[[title]]` card links: the page's first top-level pdf block. Read-only; one paint burst shares a read.
    pdfOfPage(title) {
      const name = typeof title === "string" ? title : "";
      if (!name) return null;
      const key = `pdfpage:${name}`;
      const hit = readBurst(key);
      if (hit !== MISS) return hit;
      let res = null;
      try { res = pull(PDF_PAGE_PATTERN, [":node/title", name]); } catch { res = null; }
      const value = pdfOfPageNode(res);
      if (value) {
        // A block an old upload left as `{{[[pdf]]: {{[[pdf]]: url}}}}` is rewritten once to the plain macro.
        if (typeof value.string === "string" && /\{\{[^{}]*:\s*\{\{/.test(value.string) && !repairedPdfBlocks.has(value.pdfUid)) {
          const fixed = pdfMacroUrl(value.string);
          if (fixed) {
            repairedPdfBlocks.add(value.pdfUid);
            value.string = `{{[[pdf]]: ${fixed}}}`;
            Promise.resolve(host.updateString(value.pdfUid, value.string)).catch(() => {});
          }
        }
        let kids = null;
        try { kids = pull(PDF_KIDS_PATTERN, eidKey(value.pdfUid)); } catch { kids = null; }
        const list = kids?.[":block/children"];
        value.children = Array.isArray(list) ? list.slice().sort((a, b) => (a?.[":block/order"] ?? 0) - (b?.[":block/order"] ?? 0)) : [];
      }
      writeBurst(key, value);
      return value;
    },

    // A page that already holds this file: Roam's own PDF page (:pdf/url, or :pdf/content-hash = sha256), else a
    // page whose top-level pdf block has this url. { uid, title, pdfUid, why } or null. Read-only.
    findPdfPage({ url = "", sha = "" } = {}) {
      const needle = typeof url === "string" ? url.trim() : "";
      const hash = typeof sha === "string" ? sha.trim().toLowerCase() : "";
      const withPdf = (uid, title, why) => {
        const pdf = host.pdfOfPage(title);
        return { uid, title, pdfUid: pdf?.pdfUid || "", why };
      };
      if (needle) {
        for (const row of queryRows(host, PDF_PAGE_QUERY, needle)) {
          if (Array.isArray(row) && typeof row[0] === "string" && typeof row[1] === "string") return withPdf(row[0], row[1], "url");
        }
      }
      if (/^[0-9a-f]{64}$/.test(hash)) {
        for (const row of queryRows(host, PDF_HASH_PAGE_QUERY, hash)) {
          if (Array.isArray(row) && typeof row[0] === "string" && typeof row[1] === "string") return withPdf(row[0], row[1], "sha");
        }
      }
      if (needle) {
        for (const row of queryRows(host, PDF_TOP_BLOCK_QUERY, needle)) {
          if (!Array.isArray(row) || typeof row[0] !== "string" || typeof row[1] !== "string") continue;
          const pdf = host.pdfOfPage(row[1]);
          if (pdf && pdfMacroUrl(pdf.string) === needle) return { uid: row[0], title: row[1], pdfUid: pdf.pdfUid, why: "page" };
        }
      }
      return null;
    },

    // The graph Roam has open (its own API first, the window hash second).
    graphName() {
      const live = api?.graph?.name;
      return typeof live === "string" && live ? live : gname;
    },

    pageExists(title) {
      const name = typeof title === "string" ? title.trim() : "";
      if (!name) return false;
      try { return Boolean(rawPull("[:block/uid]", [":node/title", name])?.[":block/uid"]); } catch { return true; }
    },

    // A new page with a known uid, so later writes in the same group can target it.
    async createPage({ uid, title } = {}) {
      const name = String(title ?? "").trim();
      if (!name) throw new Error("createPage: no title");
      const page = { title: name };
      if (typeof uid === "string" && uid) page.uid = uid;
      stats.writes++;
      await mutate(() => data.page.create({ page }));
      noteWrite("create");
      return page.uid || host.pageUid(name);
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
    // cardStats runs the whole job. cardStatsJob is one step per call: the pull (or the cache) is a
    // single step, and a query fallback is one of refs, boards, open, done. The cache is written
    // only when the job finishes, so a stopped job cannot answer the next read.
    cardStats(targets, opts) {
      const job = host.cardStatsJob(targets, opts);
      let guard = 0;
      while (guard < 8 && job.step() !== true) guard += 1;
      return job.result();
    },
    cardStatsJob(targets, { boardUid } = {}) {
      const keySet = new Set();
      for (const t of targets || []) {
        if (!t) continue;
        const ref = t.kind === "page" ? (t.title ? { title: t.title } : null) : t.uid ? { uid: t.uid } : null;
        if (!ref) continue;
        keySet.add(t.kind === "page" ? `page:${t.title}` : `uid:${t.uid}`);
      }
      const keys = [...keySet];
      if (keys.length && keys.every((key) => freshStat(boardUid, key))) {
        const result = new Map();
        for (const key of keys) result.set(key, { ...freshStat(boardUid, key) });
        return { step: () => true, result: () => result };
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
      if (!byEid.size) {
        let ran = false;
        return {
          result: () => result,
          step() { if (!ran) { ran = true; remember(result); } return true; },
        };
      }
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
      const listFor = (statusEid) => host.q(
        `[:find ?t ?x :in $ [?t ...] ?status :where [?x :block/refs ?status] (or [?x :block/parents ?t] [?x :block/page ?t])]`,
        eids, statusEid,
      );
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
      let phase = 0;
      let remembered = false;
      const finish = () => {
        if (!remembered) { remembered = true; remember(result); }
        phase = 5;
        return true;
      };
      return {
        result: () => result,
        step() {
          if (phase >= 5) return true;
          if (phase === 0) {
            phase = 1;
            if (fromPull()) return finish();
            tally(host.q(
              `[:find ?t ?b :in $ [?t ...] ?board :where [?b :block/refs ?t] (not [?b :block/parents ?board]) [(not= ?b ?board)]]`,
              eids, boardEid,
            ), "refs");
            return false;
          }
          if (phase === 1) {
            phase = 2;
            tally(host.q(
              `[:find ?t ?d :in $ [?t ...] ?board ?pat :where [?b :block/refs ?t] [?b :block/parents ?d] [?d :block/string ?s]
 [(re-pattern ?pat) ?re] [(re-find ?re ?s)] [(not= ?d ?board)]]`,
              eids, boardEid, DIAGRAM_RE,
            ), "boards");
            return false;
          }
          if (phase === 2) {
            phase = 3;
            if (todoEid != null) tally(listFor(todoEid), "open");
            return false;
          }
          phase = 4;
          if (doneEid != null) tally(listFor(doneEid), "done");
          return finish();
        },
      };
    },

    // True when the graph is end-to-end encrypted: its files are .enc and no outside service can read them.
    graphEncrypted() {
      try {
        const flag = api.graph?.isEncrypted;
        return typeof flag === "function" ? Boolean(flag.call(api.graph)) : flag === true;
      } catch {
        return false;
      }
    },

    async uploadFile(file) {
      const upload = api.file?.upload;
      if (typeof upload !== "function") throw new Error("upload-unavailable");
      const res = await upload.call(api.file, { file });
      const raw = typeof res === "string" ? res : res?.url;
      // Roam's file.upload resolves to markup (`![](url)` for an image, `{{[[pdf]]: url}}` for a PDF); callers want the bare URL.
      const md = typeof raw === "string" ? /^\s*!\[[^\]]*\]\((.+)\)\s*$/s.exec(raw) : null;
      const hit = typeof raw === "string" ? /https?:\/\/[^\s)}\]"']+/.exec(raw) : null;
      const url = md ? md[1] : hit ? hit[0] : "";
      if (!url) throw new Error("upload-failed");
      stats.writes++;
      return url;
    },

    async deleteFile(url) {
      const remove = api.file?.delete;
      const target = typeof url === "string" ? url.trim() : "";
      if (!target || typeof remove !== "function") return false;
      await remove.call(api.file, { url: target });
      return true;
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

    // Every PDF block in the graph, for the parsed-part index. Read-only and capped.
    listPdfBlocks(limit = 300) {
      const rows = host.q(
        `[:find ?u ?s ?t :in $ ?kind :where [?b :block/string ?s] [(re-pattern ?kind) ?kre] [(re-find ?kre ?s)]
 [?b :block/uid ?u] [?b :block/page ?p] [?p :node/title ?t]]`,
        BLOCK_KIND_PATTERNS.pdf,
      ) || [];
      const out = [];
      for (const [uid, string, pageTitle] of rows) {
        if (typeof string !== "string" || !uid) continue;
        const url = pdfMacroUrl(string) || (/https?:\/\/[^\s}]+/.exec(string) || [""])[0];
        if (!url) continue;
        out.push({ uid: String(uid), url, string, pageTitle: typeof pageTitle === "string" ? pageTitle : "" });
        if (out.length >= limit) break;
      }
      return out;
    },

    // Every image block in the graph, for the image index and image search. Read-only and capped.
    listImageBlocks(limit = 2000) {
      const rows = host.q(
        `[:find ?u ?s ?t :in $ ?kind :where [?b :block/string ?s] [(re-pattern ?kind) ?kre] [(re-find ?kre ?s)]
 [?b :block/uid ?u] [?b :block/page ?p] [?p :node/title ?t]]`,
        BLOCK_KIND_PATTERNS.image,
      ) || [];
      const out = [];
      for (const [uid, string, pageTitle] of rows) {
        if (typeof string !== "string" || !uid) continue;
        if (typeof pageTitle === "string" && pageTitle.startsWith("roam/")) continue;
        const shown = blockDisplay(string, "image");
        if (!shown.url) continue;
        out.push({ uid: String(uid), string, url: shown.url, name: shown.text, pageTitle: typeof pageTitle === "string" ? pageTitle : "" });
        if (out.length >= limit) break;
      }
      return out;
    },

    // Add-panel filters. Read-only. Each query is timed. Days and orphan never scan the graph alone.
    // `pdfMatch(url, terms)` → the PDF's identity text when it holds every term (pdf-ident), else "".
    // `pdfList()` → the graph's PDF blocks ({ uid, string, pageTitle }), cached by the caller, so typing runs no extra query.
    librarySearch(filter, limit = 40, { pdfMatch = null, pdfList = null, sort = "best" } = {}) {
      const f = normalizeLibraryFilter(filter);
      const queries = [];
      const lim = Math.max(1, Math.floor(Number(limit) || 40));
      if (!librarySelective(f)) return { rows: [], queries };
      const nowMs = Date.now();
      const since = f.days ? nowMs - f.days * 86400000 : null;
      // Room for one more page than is shown, so the panel can tell whether Show more has anything behind it.
      const cap = Math.max(libraryCap(), lim * 2);
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
      // PDFs named by what they are (title, authors, venue, first words), ahead of the capped text queries.
      // The panel caches the PDF list for one open. Tag and days still ask the graph.
      const pdfCacheOn = !f.tag && since == null && typeof pdfList === "function"
        && ((f.text && typeof pdfMatch === "function" && wantsType(f, "pdf")) || f.types.includes("pdf"));
      let pdfCached = null;
      if (pdfCacheOn) {
        try { pdfCached = pdfList() || []; } catch { pdfCached = []; }
      }
      if (f.text && typeof pdfMatch === "function" && wantsType(f, "pdf")) {
        const terms = queryTerms(f.text);
        if (pdfCacheOn) {
          const prepared = preparedPdfBlocks(pdfCached);
          for (let i = 0; i < prepared.length; i += 1) {
            if (candidates.length >= cap) break;
            const rec = prepared[i];
            let hay = "";
            try { hay = rec.url ? String(pdfMatch(rec.url, terms) || "") : ""; } catch { hay = ""; }
            if (!hay) continue;
            push({
              kind: "block",
              blockKind: "pdf",
              uid: rec.uid,
              string: rec.string,
              text: hay,
              pageTitle: rec.pageTitle,
              edited: null,
              tags: [],
              onBoard: false,
            });
          }
        } else {
          const inputs = ["$", "?kind"];
          const where = [];
          const args = [BLOCK_KIND_PATTERNS.pdf];
          if (f.tag) {
            inputs.push("?name");
            args.push(f.tag);
            where.push("[?tag :node/title ?name]", "[?b :block/refs ?tag]");
          }
          where.push("[?b :block/string ?s]", "[(re-pattern ?kind) ?kre]", "[(re-find ?kre ?s)]", "[?b :block/uid ?u]", "[?b :block/page ?p]", "[?p :node/title ?t]");
          const find = ["?s", "?u", "?t"];
          if (since != null) {
            inputs.push("?since");
            args.push(since);
            find.push("?e");
            where.push("[?b :edit/time ?e]", "[(> ?e ?since)]");
          }
          const found = timed("pdf-names", () => host.q(`[:find ${find.join(" ")} :in ${inputs.join(" ")} :where ${where.join(" ")}]`, ...args));
          for (const rec of found) {
            const string = rec?.[0];
            const uid = rec?.[1];
            const pageTitle = rec?.[2];
            if (typeof string !== "string" || !uid) continue;
            if (typeof pageTitle === "string" && pageTitle.startsWith("roam/")) continue;
            const url = pdfMacroUrl(string);
            let hay = "";
            try { hay = url ? String(pdfMatch(url, terms) || "") : ""; } catch { hay = ""; }
            if (!hay) continue;
            if (!push({
              kind: "block",
              uid: String(uid),
              string,
              text: hay,
              pageTitle: typeof pageTitle === "string" ? pageTitle : "",
              edited: since != null ? editedOf(rec?.[3]) : null,
              tags: f.tag ? [f.tag] : [],
              onBoard: false,
            })) break;
          }
        }
      }

      const wantPage = wantsType(f, "page");
      const wantBlock = wantsType(f, "block");
      const wantBoard = wantsType(f, "board");
      const wantDaily = f.types.includes("daily");
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
          args.push(ciPattern(queryTerms(f.text)[0] || f.text));
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
          args.push(ciPattern(queryTerms(f.text)[0] || f.text));
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

      if (wantBoard && (f.types.includes("board") || f.text || f.tag)) {
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
          if (f.text && !queryTerms(f.text).every((t) => title.toLowerCase().includes(t))) continue;
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

      // PDF, image, web link, region and pin blocks. One bounded string-pattern query per kind, capped like the rest.
      for (const kind of ["pdf", "image", "web", "region", "pin"]) {
        if (!f.types.includes(kind)) continue;
        if (kind === "pdf" && pdfCacheOn) {
          queries.push({ name: "pdf-cache", ms: 0 });
          const terms = f.text ? queryTerms(f.text) : [];
          const prepared = preparedPdfBlocks(pdfCached);
          for (let i = 0; i < prepared.length; i += 1) {
            if (candidates.length >= cap) break;
            const rec = prepared[i];
            if (terms.length) {
              let ok = true;
              for (let t = 0; t < terms.length; t += 1) if (!rec.lower.includes(terms[t])) { ok = false; break; }
              if (!ok) continue;
            }
            // A copy: markOnBoard and the card must not stick on the cached row. A duplicate uid (the identity hit) does not stop the rest.
            push({
              kind: "block",
              blockKind: "pdf",
              uid: rec.uid,
              string: rec.string,
              lower: rec.lower,
              pageTitle: rec.pageTitle,
              edited: null,
              tags: [],
              onBoard: false,
            });
          }
          continue;
        }
        const find = ["?s", "?u", "?t"];
        const inputs = ["$", "?kind"];
        const where = [];
        const args = [BLOCK_KIND_PATTERNS[kind]];
        if (f.tag) {
          inputs.push("?name");
          args.push(f.tag);
          where.push("[?tag :node/title ?name]", "[?b :block/refs ?tag]");
        }
        where.push("[?b :block/string ?s]", "[(re-pattern ?kind) ?kre]", "[(re-find ?kre ?s)]");
        if (f.text) {
          inputs.push("?pat");
          args.push(ciPattern(queryTerms(f.text)[0] || f.text));
          where.push("[(re-pattern ?pat) ?re]", "[(re-find ?re ?s)]");
        }
        where.push("[?b :block/uid ?u]", "[?b :block/page ?p]", "[?p :node/title ?t]");
        if (since != null) {
          inputs.push("?since");
          args.push(since);
          find.push("?e");
          where.push("[?b :edit/time ?e]", "[(> ?e ?since)]");
        }
        const found = timed(kind, () => host.q(
          `[:find ${find.join(" ")} :in ${inputs.join(" ")} :where ${where.join(" ")}]`,
          ...args,
        ));
        for (const rec of found) {
          const string = rec?.[0];
          const uid = rec?.[1];
          const pageTitle = rec?.[2];
          if (typeof string !== "string" || !uid) continue;
          if (typeof pageTitle === "string" && pageTitle.startsWith("roam/")) continue;
          if (!push({
            kind: "block",
            uid: String(uid),
            string,
            pageTitle: typeof pageTitle === "string" ? pageTitle : "",
            edited: since != null ? editedOf(rec?.[3]) : null,
            tags: f.tag ? [f.tag] : [],
            onBoard: false,
          })) break;
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

      if (f.orphan) markOnBoard(candidates, timed);

      let kept = narrowLibrary(candidates, f, nowMs);
      // Roam's own numbers (created, edited, who, linked refs, children) for the rows that survived: one read each,
      // over at most the capped candidate list, only when a sort or a Roam filter needs them.
      if (sortNeedsMeta(sort) || metaFilterHostActive(filter)) {
        timed("meta", () => { attachMeta(kept); return []; });
        kept = narrowByMeta(kept, filter, { days: f.days, now: nowMs });
      }
      const rows = sortRows(kept, sort).slice(0, lim).map(libraryCard);
      return { rows, queries, total: kept.length, more: kept.length > lim || candidates.length >= cap };
    },

    // Rows with no search text: the pages a sort puts first (recently edited / created, oldest, title), with their numbers.
    // Reads one page-level query (titles and times, never blocks) and keeps `limit` rows.
    browse(sort = "edited", limit = 40) {
      const id = ["edited", "created", "oldest", "title"].includes(sort) ? sort : "edited";
      const now = Date.now();
      if (!browsePages || now - browsePages.at > BROWSE_TTL_MS) {
        const pages = [];
        for (const [p] of host.q(`[:find (pull ?p [:node/title :block/uid :create/time :edit/time]) :where [?p :node/title]]`) || []) {
          const title = p?.[":node/title"];
          const uid = p?.[":block/uid"];
          if (typeof title === "string" && !title.startsWith("roam/") && uid) pages.push({ title, uid: String(uid), created: Number(p[":create/time"]) || null, edited: Number(p[":edit/time"]) || null });
        }
        browsePages = { at: now, pages };
      }
      const rows = browsePages.pages.map((p) => ({ kind: "page", title: p.title, uid: p.uid, meta: { created: p.created, edited: p.edited, createdBy: "", editedBy: "", refs: null, children: null, length: null }, onBoard: false, tags: [] }));
      const top = sortRows(rows, id).slice(0, Math.max(1, Math.floor(Number(limit) || 40)));
      attachMeta(top);
      return { rows: top.map(libraryCard), queries: [] };
    },

    // Rows with no search text but with filters: one bounded datalog query from the filters (filter-browse.js), ordered by
    // the sort, pulled in chunks until BROWSE_ROWS rows pass the filters the query cannot express (type, not on a board,
    // on this board, parsed / highlights). `keep(cardString)` is the board's own filter. Cached 30 s by filter set unless
    // `keep` is given (the board changes under it). Parsed PDFs / PDFs with highlights alone read the caller's PDF list.
    filterBrowse(filter, limit = 40, { sort = "best", keep = null, parsedUrls = null, pdfList = null } = {}) {
      const queries = [];
      const timed = (name, fn) => {
        const t0 = performance.now();
        let out = [];
        try { const res = fn(); out = Array.isArray(res) ? res : []; } catch { out = []; }
        queries.push({ name, ms: performance.now() - t0 });
        return out;
      };
      const lim = Math.max(1, Math.floor(Number(limit) || 40));
      const now = Date.now();
      const spec = browseSpec(filter, { now });
      if (!spec) return { rows: [], queries, spec: null, defaulted: false };
      // "Not on any board" depends on the boards: its key carries the structure epoch (a card added here misses it).
      const key = typeof keep === "function" ? "" : browseKey(spec, sort, lim, [parsedUrls instanceof Set ? parsedUrls.size : -1, spec.orphan ? structureEpoch : 0]);
      const hit = key ? filterBrowseCache.get(key) : null;
      if (hit && now - hit.at < FILTER_BROWSE_TTL_MS) {
        queries.push({ name: "browse-cache", ms: 0 });
        return { rows: hit.rows, total: hit.total ?? hit.rows.length, more: hit.more === true, queries, spec, defaulted: spec.defaulted };
      }
      const pass = (rows) => {
        let out = narrowLibrary(rows, { types: spec.types });
        if (spec.orphan && out.length) { markOnBoard(out, timed); out = out.filter((r) => !r.onBoard); }
        if (spec.pdf) out = pdfKeep(out, { parsed: spec.parsed, highlights: spec.highlights, parsedUrls }, timed);
        if (typeof keep === "function") out = out.filter((r) => { try { return keep(libraryCard(r).string); } catch { return false; } });
        return out;
      };
      let kept = [];
      let ordered = browseOrdered(spec, sort);
      const pdfOnly = spec.pdf && typeof pdfList === "function" && spec.since == null && !spec.under && !spec.createdBy && !spec.editedBy && !spec.refs && !spec.children;
      if (pdfOnly) {
        let list = [];
        try { list = pdfList() || []; } catch { list = []; }
        const rows = list.filter((r) => r?.uid && !String(r.pageTitle || "").startsWith("roam/"))
          .map((r) => ({ kind: "block", uid: String(r.uid), string: r.string, pageTitle: r.pageTitle || "", edited: null, tags: [], onBoard: false }));
        kept = pass(rows);
        // The list has no times: order by Roam's numbers.
        ordered = false;
      } else {
        const users = {};
        if (spec.createdBy) users.created = userIdsFor(spec.createdBy);
        if (spec.editedBy) users.edited = userIdsFor(spec.editedBy);
        const plan = browseQuery(spec, { patterns: { ...BLOCK_KIND_PATTERNS, board: DIAGRAM_RE }, users, sort });
        const found = plan ? timed("browse", () => host.q(plan.query, ...plan.args)) : [];
        // Most linked / Most children with that filter on: count by entity id over the newest BROWSE_COUNT_MAX rows.
        let counts = null;
        const countBy = browseCountBy(spec, sort);
        if (countBy && found.length) {
          const eids = orderBrowse(found, "edited").slice(0, BROWSE_COUNT_MAX).map((o) => o.eid);
          counts = new Map();
          for (const [eid, c] of timed("browse-count", () => host.q(countBy === "refs" ? META_REFS : CHILD_COUNTS, eids))) counts.set(eid, Number(c) || 0);
        }
        const order = orderBrowse(found, sort, counts);
        const edited = plan?.time === "edited";
        const wantBoard = spec.types.length === 0 || spec.types.includes("board");
        const pullMany = (eids) => (typeof data.pull_many === "function" ? data.pull_many(BROWSE_PULL, eids) : eids.map((e) => rawPull(BROWSE_PULL, e)));
        const keepMax = Math.max(BROWSE_ROWS, lim);
        for (let i = 0; i < order.length && i < BROWSE_SCAN && kept.length < keepMax; i += BROWSE_CHUNK) {
          const chunk = order.slice(i, Math.min(i + BROWSE_CHUNK, BROWSE_SCAN));
          const nodes = timed("browse-pull", () => pullMany(chunk.map((o) => o.eid)) || []);
          const rows = [];
          nodes.forEach((node, j) => {
            const uid = node?.[":block/uid"];
            if (typeof uid !== "string" || !uid) return;
            const o = chunk[j];
            const title = node[":node/title"];
            const base = { uid, edited: edited ? o.time : null, tags: [], onBoard: false };
            if (typeof title === "string") {
              if (!title.startsWith("roam/")) rows.push({ ...base, kind: "page", title });
              return;
            }
            const string = typeof node[":block/string"] === "string" ? node[":block/string"] : "";
            const pageTitle = node[":block/page"]?.[":node/title"];
            if (typeof pageTitle === "string" && pageTitle.startsWith("roam/")) return;
            if (DIAGRAM_STRING.test(string)) {
              if (!wantBoard) return;
              const props = node[":block/props"] && typeof node[":block/props"] === "object" ? plainKeys(node[":block/props"]) : {};
              if (props?.plexus?.v !== 2) return;
              rows.push({ ...base, kind: "board", title: parseBoardTitle(string) || "Untitled board", string, pageTitle: typeof pageTitle === "string" ? pageTitle : "", onBoard: true });
              return;
            }
            rows.push({ ...base, kind: "block", string, pageTitle: typeof pageTitle === "string" ? pageTitle : "" });
          });
          for (const row of pass(rows)) { if (kept.length < keepMax) kept.push(row); }
        }
      }
      // The query gave the order: numbers only for the rows shown. Otherwise every kept row's numbers, then the sort.
      let top;
      if (ordered) {
        top = kept.slice(0, lim);
        timed("meta", () => { attachMeta(top); return []; });
      } else {
        timed("meta", () => { attachMeta(kept); return []; });
        top = sortRows(kept, pdfOnly && sort === "best" ? "edited" : sort).slice(0, lim);
      }
      const rows = top.map((r) => libraryCard(r));
      if (key) {
        filterBrowseCache.delete(key);
        filterBrowseCache.set(key, { at: now, rows, total: kept.length, more: kept.length > lim || (!pdfOnly && kept.length >= Math.max(BROWSE_ROWS, lim)) });
        while (filterBrowseCache.size > FILTER_BROWSE_MAX) filterBrowseCache.delete(filterBrowseCache.keys().next().value);
      }
      return { rows, total: kept.length, more: kept.length > lim || (!pdfOnly && kept.length >= Math.max(BROWSE_ROWS, lim)), queries, spec, defaulted: spec.defaulted };
    },

    // Parsed PDFs / PDFs with highlights over rows another search found (keyword rows, Meaning rows). Non-PDF rows go.
    pdfFilter(rows, { parsed = false, highlights = false, parsedUrls = null } = {}) {
      const list = Array.isArray(rows) ? rows : [];
      if (!parsed && !highlights) return list;
      return pdfKeep(list, { parsed, highlights, parsedUrls }, (name, fn) => { try { const r = fn(); return Array.isArray(r) ? r : []; } catch { return []; } });
    },

    // Display names of the graph's users, for the created-by / edited-by filters.
    userNames() {
      const names = new Set();
      for (const query of USER_NAME_QUERIES) for (const r of host.q(query) || []) if (typeof r?.[0] === "string" && r[0]) names.add(r[0]);
      return [...names].sort((a, b) => a.localeCompare(b));
    },

    // What names a PDF block besides its file: the page it owns (first top-level PDF of a non-daily page)
    // and Roam's PDF page for its url (:pdf/url). Read-only.
    pdfNameInfo(uid, url = "") {
      const out = { ownTitle: "", pdfPageTitle: "" };
      if (uid) {
        try {
          // Roam's own pull: the card cache may hold the page without its children.
          const res = rawPull("[:block/uid {:block/parents [:db/id]} {:block/page [:block/uid :node/title {(limit :block/children nil) [:block/uid :block/string :block/order]}]}]", eidKey(uid));
          const page = res?.[":block/page"];
          const parents = res?.[":block/parents"];
          const title = page?.[":node/title"];
          if (typeof title === "string" && Array.isArray(parents) && parents.length === 1 && !isDailyTitle(title)) {
            if (pdfOfPageNode(page)?.pdfUid === uid) out.ownTitle = title;
          }
        } catch { /* no name */ }
      }
      if (url) {
        for (const row of queryRows(host, PDF_PAGE_QUERY, url)) {
          const title = Array.isArray(row) ? row[1] : "";
          if (typeof title === "string" && title && !/^notes by\b/i.test(title) && !isDailyTitle(title)) { out.pdfPageTitle = title; break; }
        }
      }
      return out;
    },

    // Roam semantic-search results → Add-panel rows with the panel's filters (type, tag, days, not on any board).
    semanticRows(raw, filter, limit = 40, { sort = "best", parsedUrls = null, pdfList = null } = {}) {
      const f = normalizeLibraryFilter(filter);
      const queries = [];
      const timed = (name, fn) => {
        const t0 = performance.now();
        let out = [];
        try { const res = fn(); out = Array.isArray(res) ? res : []; } catch { out = []; }
        queries.push({ name, ms: performance.now() - t0 });
        return out;
      };
      // url → pdf block: the caller's cached PDF list first, then one string-pattern read; one answer per url per call.
      const pdfByUrl = new Map();
      const pdfBlockOf = (url) => {
        if (pdfByUrl.has(url)) return pdfByUrl.get(url);
        let list = null;
        try { list = typeof pdfList === "function" ? pdfList() : null; } catch { list = null; }
        const listed = Array.isArray(list) ? list.find((r) => r?.uid && pdfMacroUrl(r.string) === url) : null;
        const found = listed ? { uid: String(listed.uid), string: listed.string, pageTitle: listed.pageTitle || "" } : pdfBlockRead(url);
        pdfByUrl.set(url, found);
        return found;
      };
      const pdfBlockRead = (url) => {
        const rows = timed("sem-pdf", () => host.q(
          `[:find ?u ?s ?t :in $ ?kind :where [?b :block/string ?s] [(re-pattern ?kind) ?kre] [(re-find ?kre ?s)] [?b :block/uid ?u] [?b :block/page ?p] [?p :node/title ?t]]`,
          BLOCK_KIND_PATTERNS.pdf,
        ));
        for (const [u, string, t] of rows) if (pdfMacroUrl(string) === url) return { uid: u, string, pageTitle: t };
        return null;
      };
      const t0 = performance.now();
      const pdfPages = filter?.parsed === true || filter?.highlights === true;
      const candidates = semanticCandidates(raw, { pull: (uid) => pull(SEM_PULL, eidKey(uid)), pdfBlockOf, pdfPages })
        .filter((row) => !(row.kind === "block" && DIAGRAM_STRING.test(row.string)));
      queries.push({ name: "sem-pull", ms: performance.now() - t0 });
      if (f.orphan) markOnBoard(candidates, timed);
      let kept = narrowLibrary(candidates, { ...f, text: "" }, Date.now());
      if (sortNeedsMeta(sort) || metaFilterHostActive(filter)) {
        timed("sem-meta", () => { attachMeta(kept); return []; });
        kept = narrowByMeta(kept, filter, { days: f.days });
      }
      // Parsed PDFs / PDFs with highlights: a hit on or under a PDF (or on its Roam PDF page) is that PDF's row; the rest go.
      if (filter?.parsed === true || filter?.highlights === true) kept = pdfKeep(kept, { parsed: filter.parsed === true, highlights: filter.highlights === true, parsedUrls }, timed);
      if (sort !== "best") kept = sortRows(kept, sort);
      return { rows: kept.slice(0, Math.max(1, Math.floor(Number(limit) || 40))).map((row) => ({ ...libraryCard(row), semantic: true })), queries };
    },

    // A card's text for "Find related": the page title or block string and its first children.
    relatedText(ref) {
      if (!ref) return "";
      try {
        const res = ref.kind === "page"
          ? pull("[:node/title {(limit :block/children nil) [:block/string :block/order]}]", [":node/title", ref.title])
          : pull("[:block/string :node/title {(limit :block/children nil) [:block/string :block/order]}]", eidKey(ref.uid));
        const kids = (Array.isArray(res?.[":block/children"]) ? res[":block/children"] : [])
          .slice().sort((a, b) => (a?.[":block/order"] ?? 0) - (b?.[":block/order"] ?? 0))
          .map((c) => c?.[":block/string"] || "");
        return relatedQueryText({ title: res?.[":node/title"] || ref.title || "", string: res?.[":block/string"] || "", children: kids });
      } catch {
        return "";
      }
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

    // Blocks that reference a card's page or block, each with the title of the page it sits on: [{ uid, pageTitle }].
    // Blocks inside this board are skipped, as in neighborPages. A throw yields nothing.
    linkedRefBlocks(item, { boardUid } = {}) {
      if (!item || item.type === "section") return [];
      const kind = item.target?.kind || item.kind || "self";
      if (kind === "board" || item.kind === "board") return [];
      const pageTitle = kind === "page" ? String(item.target?.title || item.title || "") : "";
      const blockUid = pageTitle ? "" : String(item.target?.uid || item.uid || "");
      if (!pageTitle && !blockUid) return [];
      try {
        const boardEid = boardUid ? host.resolveEid({ uid: boardUid }) ?? -1 : -1;
        const rows = host.q(
          pageTitle
            ? `[:find ?u ?pt :in $ ?title ?board :where [?p :node/title ?title] [?b :block/refs ?p] (not [?b :block/parents ?board]) [(not= ?b ?board)] [?b :block/uid ?u] [?b :block/page ?pg] [?pg :node/title ?pt]]`
            : `[:find ?u ?pt :in $ ?uid ?board :where [?s :block/uid ?uid] [?b :block/refs ?s] (not [?b :block/parents ?board]) [(not= ?b ?board)] [?b :block/uid ?u] [?b :block/page ?pg] [?pg :node/title ?pt]]`,
          pageTitle || blockUid,
          boardEid,
        ) || [];
        return linkedRefRows(rows, { selfTitle: pageTitle, selfUid: blockUid });
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
        try { res = pull("[:block/string {(limit :block/children nil) [:block/string]}]", eidKey(targetUid)); } catch { res = null; }
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
  installCommentHost(host, { api, data });
  return host;
}
