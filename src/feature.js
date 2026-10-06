import pkg from "../package.json" with { type: "json" };
import { createHost } from "./host/roam.js";
import { acquireSession as acquireSessionDefault } from "./session.js";
import { clearPinnedToast, mountBoardView, viewportStorageId } from "./view/board-view.js";
import {
  captureSketch,
  createSketchStore,
  paintSketch,
  removeSketch,
  resolveSketchViewport,
  SKETCH_DEBOUNCE_MS,
  SKETCH_HOLD_MS,
  SKETCH_ROOT_BORDER,
} from "./view/sketch.js";
import { isTextEntryTarget } from "./view/cards.js";
import { assignDeepLink, hashFromUrl, pageUidFromHash, pxdTarget } from "./model/deeplink.js";
import { openAddToBoard } from "./view/board-picker.js";
import { createRelChips } from "./relchips.js";
import { createBoardChips } from "./boardchips.js";
import { createCardChips } from "./cardchips.js";
import { createPrefetch } from "./prefetch.js";
import { createResurface } from "./view/resurface-panel.js";
import { closeOpenWhyPopovers } from "./view/why-pop.js";
import { createCardCache } from "./model/card-cache.js";
import { imageSrc } from "./model/export.js";
import { parseRegion } from "./model/regions.js";
import { classifyString, parseBoardTitle, readPlexus, UNTITLED_BOARD } from "./model/schema.js";
import { eachRegionButton, openRegionCrop, openRegionView, regionUidForButton, resetCropUrls } from "./view/region-crop.js";
import { chromeObstacles } from "./view/avoid.js";
import { holeRect, previewImageBox, setCameraFromView } from "./view/region-hover-geom.js";
import { drawViewMap, minimapSvg, viewMapModel } from "./view/minimap-svg.js";
import { boundsOf, buildBoard, worldRects } from "./model/board.js";
import { boardBounds, createPublicApi, emitPublicEvent, fitThumbSize, installPublicApi, thumbStroke, uninstallPublicApi } from "./model/public-api.js";
import { motionProfile, resolveMotion } from "./view/motion.js";
import { createShowStash, pickCameraMount, resolveRegionTarget } from "./view/region-open.js";
import { tooltipDelay } from "./view/tooltip.js";
import { mountOutlineRegion, OUTLINE_TOAST, outlineToast } from "./view/region-outline.js";
import {
  autoEligibility,
  BLOCK_CONTAINER_SELECTOR,
  blockContainerUid,
  diagramsWithin,
  diagramUidFromLocation,
  enhancedUidGuardCss,
  embedBoardUid,
  embedOwnerUid,
  embedScope,
  findDiagramUidFromEl,
  isDiagramString,
  NATIVE_HIDDEN_CLASS,
  OUTLINE_NATIVE_CLASS,
  PREPAINT_STYLE_ID,
  readEnhanced,
  readEnhancedUidCache,
  routeLeftZoomedDiagram,
  storedLayoutIn,
  writeEnhancedUidCache,
} from "./discovery.js";
import { bindSpeedFlagSource, normalizeSetting, noteSpeedFlags, notedSpeedFlags, onSettingsChange, parseSpeedFlags, readSettings, SETTING_IDS } from "./settings.js";
import { createPerfLog, perfNow } from "./perf-log.js";
import { createShiftWatch } from "./view/shift-watch.js";

// Roam reports `extension.version` as "DEV" for URL / local developer installs,
// so the toolbar badge is stamped from package.json first.
export const PACKAGE_VERSION = pkg.version;

export const RECONCILE_INTERVAL_MS = 400;
// A uid already classified as not enhanced is not pulled again for about 30s.
// An enhance command, or hashchange/popstate, clears that classification.
const NEGATIVE_TTL_MS = 30000;
const MOUNT_BACKOFF_MS = [5000, 30000];
// FAST-5. Navigation keeps this many canvases, off the document, per window.
const KEEP_ALIVE_CAP = 2;
const KEEP_ALIVE_MS = 300000;
const LEGACY_METADATA_PAGE = "plexus-diagram/metadata";
const TITLE_PANEL_CLASS = "rm-diagram-title-panel";
const NEW_BOARD_STRING = "{{[[diagram]]:Untitled board}}";
const AUTO_PATTERN = "[:block/props {:block/children [:block/props]}]";
const CONVERT_LABEL = "Open as Plexus board";
const CONVERT_TITLE = "Imports this diagram's shapes and arrows into a Plexus board. Plexus: Restore native diagram gives it back.";
const ANCESTORS_PATTERN = "[:block/uid :block/string {:block/parents [:block/uid :block/string :block/props {:block/parents [:db/id]}]}]";
const boardTitle = (s) => parseBoardTitle(s) || UNTITLED_BOARD;
const currentUid = (rec) => rec.crumbs[rec.crumbs.length - 1].uid;

function crumbCopy(list) {
  return (list || []).map((c) => ({ uid: c.uid, title: c.title }));
}

function sameTrail(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i].uid !== b[i].uid) return false;
  return true;
}

// classList.add/remove of a token that is already in the right state still writes the
// attribute in Roam, so a 400 ms reconcile was mutating every diagram's class.
function setClassToken(el, name, on) {
  const list = el?.classList;
  if (!list || typeof list.contains !== "function" || !name) return;
  const has = Boolean(list.contains(name));
  if (on) { if (!has) list.add(name); }
  else if (has) list.remove(name);
}

function cameraOf(rec) {
  try {
    const v = rec.view?.viewport?.();
    if (v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.zoom) && v.zoom > 0) {
      return { x: v.x, y: v.y, zoom: v.zoom };
    }
  } catch { /* the view has no camera */ }
  return null;
}

function shot(rec) {
  return { crumbs: crumbCopy(rec.crumbs), vp: cameraOf(rec) };
}
const PARENTS_QUERY = "[:find ?u ?s :in $ ?uid :where [?b :block/uid ?uid] [?b :block/parents ?p] [?p :block/uid ?u] [?p :block/string ?s]]";

function graphFromHash(hash = globalThis.location?.hash || "") {
  const match = String(hash).match(/#\/app\/([^/]+)/);
  return match ? match[1] : "unknown";
}

function pulledString(node) {
  return String(node?.[":block/string"] ?? node?.string ?? "");
}

function pulledChildren(node) {
  return node?.[":block/children"] ?? node?.children ?? [];
}

function hasMigratedMark(node) {
  for (const child of pulledChildren(node)) {
    if (/^migrated::\s*2\b/i.test(pulledString(child).trim()) || hasMigratedMark(child)) return true;
  }
  return false;
}

function uidFromLegacyString(value) {
  const token = String(value).trim().split(/\s+/)[0] || "";
  const bare = token.replace(/^(\(\(|\[\[)/, "").replace(/(\)\)|\]\])$/, "");
  return /^[\w-]{6,}$/.test(bare) ? bare : null;
}

// 0.6 boards live in [[plexus-diagram/metadata]] -> `enhanced::` -> <boardUid>. Read once at load.
export function readLegacyEnhanced(host) {
  const out = new Set();
  try {
    const pageUid = host.pageUid?.(LEGACY_METADATA_PAGE);
    if (!pageUid) return out;
    const tree = host.api.data.pull("[:block/uid :block/string {:block/children ...}]", [":block/uid", pageUid]);
    const list = pulledChildren(tree).find((child) => /^enhanced::/i.test(pulledString(child).trim()));
    for (const entry of pulledChildren(list)) {
      const uid = uidFromLegacyString(pulledString(entry));
      if (uid && !hasMigratedMark(entry)) out.add(uid);
    }
  } catch (error) {
    console.warn("[plexus-diagram] Could not read the 0.6 enhanced list", error);
  }
  return out;
}

function isMobile(extensionAPI) {
  const flag = extensionAPI?.platform?.isMobile;
  return typeof flag === "function" ? Boolean(flag.call(extensionAPI.platform)) : Boolean(flag);
}

export async function installPlexusDiagram({
  extensionAPI,
  lifecycle,
  version,
  mountView,
  host: injectedHost,
  acquireSession: injectedAcquire,
  storage = globalThis.localStorage,
}) {
  const doc = globalThis.document;
  const win = globalThis.window ?? globalThis;
  const badge = PACKAGE_VERSION || version || "DEV";
  // First disposer runs last. A why popover sits on document.body, outside every mount.
  lifecycle.add(() => {
    try { closeOpenWhyPopovers(); } catch { /* already gone */ }
    const nodes = doc?.querySelectorAll?.("[class*='pxd-']");
    for (const el of [...(nodes || [])]) {
      try {
        const classes = String(el.getAttribute?.("class") ?? el.className ?? "").split(/\s+/).filter(Boolean);
        // A Roam node (a second diagram in an embed) only carries our marker classes. React owns the node.
        if (classes.some((name) => /^(rm-|roam-)/.test(name))) {
          for (const name of classes) if (name.startsWith("pxd-")) el.classList.remove(name);
        } else {
          el.remove();
        }
      } catch { /* already gone */ }
    }
  });

  if (!injectedHost) injectedHost = createHost();
  if (!injectedAcquire) injectedAcquire = acquireSessionDefault;
  if (!mountView) mountView = mountBoardView;
  const host = injectedHost;
  const acquireSession = injectedAcquire;
  const perfLog = createPerfLog();
  perfLog.bind(host.stats);
  const shiftWatch = createShiftWatch();
  // Same graph string the viewport store uses. host.graph wins when a test or host sets it.
  const sketchStore = createSketchStore({
    storage,
    graph: () => {
      if (typeof host.graph === "string" && host.graph) return host.graph;
      try {
        const match = /#\/app\/([^/?#]+)/.exec(String(globalThis.location?.hash || ""));
        if (match) return decodeURIComponent(match[1]);
      } catch { /* the hash is not a graph name */ }
      return graphFromHash();
    },
    enabled: () => notedSpeedFlags().sketch !== false,
  });
  const sketchTimers = new Map();
  const sketchHandoffs = new Map();

  let settings = readSettings(extensionAPI);
  // Hidden speed-flags. The panel never lists this id, so the next gate re-reads the store.
  bindSpeedFlagSource(() => {
    try { return extensionAPI?.settings?.get?.(SETTING_IDS.speedFlags); }
    catch { return null; }
  });
  lifecycle.add(() => bindSpeedFlagSource(null));
  const speedFlags = () => notedSpeedFlags();
  // Sessions outlive a settings change (they are ref-counted and kept), so they read through this accessor.
  const liveSettings = { get: (id) => settings[id] };
  let stopped = false;
  let closeAddToBoard = () => {};
  let closeCommandSheet = () => {};
  const mounts = new Map(); // native element -> record
  const trusted = new Set(); // uids confirmed enhanced by this runtime (command results)
  const portalObservers = new Map(); // portal node -> its own added-nodes observer
  const negativeUntil = new Map(); // uid -> timestamp before which a failed pull is not repeated
  const mountFail = new Map(); // uid -> { n, until } after a thrown mount; not retried every reconcile tick
  const autoCache = new Map(); // uid -> { kind: "virtual" | "convert" | null, at } (auto-enhance decision, one read per TTL)
  const virtualUids = new Set(); // uids shown as a board with no :plexus written yet
  const convertButtons = new Map(); // native element -> { el, uid }
  const legacyUids = readLegacyEnhanced(host);
  const guardUids = new Set([...readEnhancedUidCache(storage), ...legacyUids]);
  let guardStyle = null;
  // RF-3: relation chips under connection blocks Roam renders outside a board. Fed by the same mutation observer.
  const relChips = createRelChips({ doc, win, host, graph: () => host.graph || graphFromHash(), openNested: (boardUid, edgeUid) => openNestedConnection(boardUid, edgeUid) });
  const cardCache = createCardCache();
  const boardChips = createBoardChips({ doc, cache: cardCache });
  const pageUidByTitle = new Map();
  const previewBoards = new Map(); // board uid -> built board for the chip hover popover; dropped when that board changes
  let publicEmit = () => {};
  const noteCards = (board) => {
    if (!board?.uid || !board.items) return;
    const children = [];
    for (const item of board.items.values()) {
      if (!item?.uid || item.type !== "card") continue;
      let target = "";
      if (item.target?.kind === "block" && item.target.uid) target = item.target.uid;
      else if (item.target?.kind === "page" && item.target.title) {
        const title = item.target.title;
        if (pageUidByTitle.has(title)) target = pageUidByTitle.get(title);
        else {
          try { target = host.pageUid?.(title) || ""; } catch { target = ""; }
          if (target) pageUidByTitle.set(title, target);
        }
      }
      children.push({ uid: item.uid, target, string: typeof item.string === "string" ? item.string : "" });
    }
    const title = board.title || parseBoardTitle(board.string) || "";
    cardCache.setBoard(board.uid, title, children);
    previewBoards.delete(board.uid);
  };
  const cardChips = createCardChips({
    doc,
    cache: cardCache,
    enabled: () => settings[SETTING_IDS.cardChips] !== false,
    pageUid: () => openPageUid(),
    onOpen: ({ boardUid, cardUid, sidebar }) => { void openPublic(boardUid, { card: cardUid, sidebar }); },
    onPreview: ({ boardUid, cardUid }) => chipPreview(boardUid, cardUid),
  });
  // FAST-4. Chip hovers, crumbs, nested boards, and known refs share this warm. FAST-9 gates it with `enabled`.
  const schedulePrefetch = createPrefetch({
    doc,
    cache: cardCache,
    warm: (uid) => host.prefetchBoard?.(uid),
    isWarm: (uid) => host.prefetchBoard?.warm?.(uid) === true,
    refBoards: (uid) => host.prefetchBoard?.refBoards?.(uid) || [],
    pageBoards: (title) => host.prefetchBoard?.pageBoards?.(title) || [],
    enabled: () => speedFlags().prefetch !== false,
  });
  const publishCards = (board) => {
    if (board) {
      relChips.noteBoard(board);
      noteCards(board);
      const targets = [];
      for (const item of board.items?.values?.() || []) {
        if (item?.type === "card" && item.target?.kind === "block" && item.target.uid) targets.push(item.target.uid);
      }
      boardChips.scanUids(targets);
    } else {
      boardChips.scan(doc?.body);
    }
    cardChips.scan(doc?.body);
    relChips.scan(doc?.body);
  };
  let resurfaceRows = [];
  let resurfaceAt = 0;
  const resurfaceList = () => {
    if (resurfaceRows.length && Date.now() - resurfaceAt < 60000) return resurfaceRows;
    const entries = cardCache.entries();
    const uids = [...new Set(entries.map((row) => row.uid).filter(Boolean))];
    if (!uids.length) {
      resurfaceRows = [];
      return resurfaceRows;
    }
    let times = [];
    try {
      times = uids.length && typeof host.q === "function"
        ? host.q("[:find ?u ?t ?s :in $ [?u ...] :where [?e :block/uid ?u] [?e :create/time ?t] [?e :block/string ?s]]", uids) || []
        : [];
    } catch {
      times = [];
    }
    const byUid = new Map(times.map((row) => [row[0], row]));
    resurfaceRows = [];
    for (const row of entries) {
      const hit = byUid.get(row.uid);
      if (!hit || !Number.isFinite(hit[1])) continue;
      const line = String(hit[2] || "Card").split("\n")[0].slice(0, 80);
      resurfaceRows.push({ ...row, time: hit[1], title: `${line} · ${row.title}` });
    }
    resurfaceAt = Date.now();
    return resurfaceRows;
  };
  const resurface = createResurface({
    doc,
    pageTitle: () => doc?.querySelector?.("h1.rm-title-display")?.textContent || "",
    intervals: () => settings[SETTING_IDS.resurfaceIntervals] || "7,30,90,365",
    rows: resurfaceList,
    onOpen: ({ boardUid, cardUid }) => { void openPublic(boardUid, { card: cardUid }); },
  });
  lifecycle.add(() => relChips.dispose());
  lifecycle.add(() => boardChips.dispose());
  lifecycle.add(() => cardChips.dispose());
  lifecycle.add(() => schedulePrefetch.dispose());
  lifecycle.add(() => resurface.dispose());
  const editSeen = new Map();
  lifecycle.add(() => previewBoards.clear());
  lifecycle.add(() => clearPinnedToast());
  let cacheLoadMs = null;
  // A board that left the enhanced set or was deleted takes its chips with it.
  const dropBoardCards = (uid) => {
    if (!uid) return;
    cardCache.setBoard(uid, "", []);
    previewBoards.delete(uid);
    editSeen.delete(uid);
    boardChips.scan(doc?.body);
    cardChips.scan(doc?.body);
  };
  function refreshCardCache() {
    const started = Date.now();
    const uids = [...guardUids];
    let edits = [];
    try {
      edits = uids.length && typeof host.q === "function"
        ? host.q("[:find ?u ?t :in $ [?u ...] :where [?b :block/uid ?u] [?b :edit/time ?t]]", uids) || []
        : [];
    } catch { edits = []; }
    const next = new Map();
    for (const row of edits) {
      if (Array.isArray(row) && row.length >= 2) next.set(row[0], row[1]);
    }
    const due = [];
    for (const uid of uids) {
      const stamp = next.has(uid) ? next.get(uid) : null;
      if (editSeen.has(uid) && editSeen.get(uid) === stamp) continue;
      due.push(uid);
    }
    for (const uid of due) {
      let board = null;
      let read = true;
      try {
        const pulled = host.pullBoard?.(uid);
        board = pulled ? buildBoard(pulled) : null;
      } catch { board = null; read = false; }
      // The stamp is remembered only after a pull that did not throw, so a failed read is tried again.
      if (read) editSeen.set(uid, next.has(uid) ? next.get(uid) : null);
      previewBoards.delete(uid);
      if (board?.uid) noteCards(board);
      else cardCache.setBoard(uid, "", []);
    }
    for (const rec of mounts.values()) {
      if (rec.session?.board) noteCards(rec.session.board);
    }
    if (cacheLoadMs == null) cacheLoadMs = Date.now() - started;
    boardChips.scan(doc?.body);
    cardChips.scan(doc?.body);
  }
  function chipPreview(boardUid, cardUid) {
    let board = null;
    for (const rec of mounts.values()) {
      if (rec.session?.board?.uid === boardUid) board = rec.session.board;
    }
    if (!board) board = previewBoards.get(boardUid) || null;
    if (!board) {
      try {
        const pulled = host.pullBoard?.(boardUid);
        board = pulled ? buildBoard(pulled) : null;
      } catch { board = null; }
      if (board) {
        previewBoards.set(boardUid, board);
        while (previewBoards.size > 12) previewBoards.delete(previewBoards.keys().next().value);
      }
    }
    const title = board?.title || cardCache.titleOf(boardUid);
    if (!board) return { title, section: "", svg: null };
    const rects = worldRects(board);
    const ids = [cardUid];
    for (const edge of board.edges.values()) {
      if (edge && edge.valid === false) continue;
      const other = edge.from === cardUid ? edge.to : edge.to === cardUid ? edge.from : "";
      if (!other || ids.includes(other)) continue;
      ids.push(other);
      if (ids.length >= 3) break;
    }
    const items = [];
    for (const id of ids) {
      const rect = rects.get(id);
      if (rect) items.push({ ...rect, hot: id === cardUid });
    }
    const svg = items.length ? minimapSvg(doc, { v: boundsOf(items), items, size: 320 }) : null;
    let section = "";
    let parent = board.items.get(cardUid)?.parentUid;
    while (parent && parent !== board.uid) {
      const item = board.items.get(parent);
      if (!item) break;
      if (item.type === "section") { section = item.title || ""; break; }
      parent = item.parentUid;
    }
    return { title, section, svg };
  }
  const regionCrops = new Map(); // region button -> its destroy
  const showStash = createShowStash();
  let showWhere = "main";
  const viewBoards = new Map();
  const VIEW_BOARD_TTL_MS = 5000;
  let outlineMark = null;
  let toastOff = () => {};
  const say = (message) => {
    toastOff();
    toastOff = outlineToast(doc, message);
  };
  lifecycle.add(() => {
    outlineMark?.destroy?.();
    outlineMark = null;
    toastOff();
    toastOff = () => {};
    for (const drop of [...regionCrops.values()]) drop();
    regionCrops.clear();
    resetCropUrls();
  });

  const active = () => !stopped && settings[SETTING_IDS.enabled] !== false
    && !(settings[SETTING_IDS.disableOnMobile] && isMobile(extensionAPI));

  // Runs last on dispose (disposers unwind in reverse): tear every mount down, restore native Roam.
  lifecycle.add(() => {
    for (const native of [...convertButtons.keys()]) dropConvert(native);
    for (const rec of [...mounts.values()]) unmount(rec);
    disposeAlive();
    for (const observer of portalObservers.values()) observer.disconnect();
    portalObservers.clear();
    // Outline copies skipped by consider() carry a mark that no mount owns; clear it so unload leaves nothing.
    for (const el of [...(doc?.querySelectorAll?.(`.${OUTLINE_NATIVE_CLASS}`) || [])]) setClassToken(el, OUTLINE_NATIVE_CLASS, false);
    guardStyle?.remove?.();
    guardStyle = null;
  });

  function syncGuard() {
    if (!doc) return;
    if (!active()) {
      if (guardStyle) guardStyle.textContent = "";
      return;
    }
    if (!guardStyle) {
      guardStyle = doc.getElementById?.(PREPAINT_STYLE_ID) || doc.createElement("style");
      guardStyle.id = PREPAINT_STYLE_ID;
      if (!guardStyle.isConnected) doc.head.appendChild(guardStyle);
    }
    guardStyle.textContent = enhancedUidGuardCss(guardUids);
    try {
      writeEnhancedUidCache(guardUids, storage);
    } catch { /* storage is a cache only */ }
  }

  function markEnhanced(uid) {
    trusted.add(uid);
    guardUids.add(uid);
    negativeUntil.delete(uid);
    autoCache.delete(uid);
    virtualUids.delete(uid);
    syncGuard();
  }

  function markNative(uid) {
    trusted.delete(uid);
    legacyUids.delete(uid);
    guardUids.delete(uid);
    autoCache.delete(uid);
    virtualUids.delete(uid);
    syncGuard();
    dropBoardCards(uid);
  }

  // Auto-enhance decision for a diagram that is not a v2 board: "virtual", "convert", or null. Read once per TTL.
  function autoKind(uid) {
    if (!uid || settings[SETTING_IDS.autoEnhance] === false) return null;
    const hit = autoCache.get(uid);
    if (hit && Date.now() - hit.at < NEGATIVE_TTL_MS) return hit.kind;
    let kind = null;
    let enhanced = false;
    try {
      const pulled = host.api.data.pull(AUTO_PATTERN, [":block/uid", uid]);
      const plexus = readPlexus(pulled?.[":block/props"] ?? pulled?.props ?? null);
      enhanced = plexus?.v === 2;
      let nativeNodeCount = 0;
      if (!enhanced && plexus?.native !== true) {
        const nodes = host.pullNative?.(uid)?.[":diagram/nodes"];
        nativeNodeCount = Array.isArray(nodes) ? nodes.length : 0;
      }
      kind = autoEligibility({ plexus, nativeNodeCount, storedLayout: storedLayoutIn(pulled?.[":block/children"]) });
    } catch {
      kind = null;
      enhanced = false;
    }
    autoCache.set(uid, { kind, enhanced, at: Date.now() });
    return kind;
  }

  const virtualOptions = (virtual) => (virtual ? { virtual: true } : {});

  function isBoardEnhanced(uid) {
    if (trusted.has(uid) || legacyUids.has(uid)) return true;
    const until = negativeUntil.get(uid);
    if (until && until > Date.now()) return false;
    const auto = autoCache.get(uid);
    const autoFresh = Boolean(auto && Date.now() - auto.at < NEGATIVE_TTL_MS);
    if (autoFresh && auto.enhanced) {
      trusted.add(uid);
      virtualUids.delete(uid);
      autoCache.delete(uid);
      if (!guardUids.has(uid)) {
        guardUids.add(uid);
        syncGuard();
      }
      return true;
    }
    if (autoFresh && auto.kind === "virtual" && virtualUids.has(uid)) return true;
    // The auto-enhance read already classified this uid. Do not pull :block/props again.
    if (autoFresh && auto.kind !== "virtual") {
      virtualUids.delete(uid);
      negativeUntil.set(uid, Date.now() + NEGATIVE_TTL_MS);
      if (guardUids.has(uid)) {
        guardUids.delete(uid);
        syncGuard();
      }
      return false;
    }
    if (readEnhanced(host.api, uid)) {
      trusted.add(uid);
      virtualUids.delete(uid);
      autoCache.delete(uid);
      if (!guardUids.has(uid)) {
        guardUids.add(uid);
        syncGuard();
      }
      return true;
    }
    if (autoKind(uid) === "virtual") {
      virtualUids.add(uid);
      if (!guardUids.has(uid)) {
        guardUids.add(uid);
        syncGuard();
      }
      return true;
    }
    virtualUids.delete(uid);
    negativeUntil.set(uid, Date.now() + NEGATIVE_TTL_MS);
    if (guardUids.has(uid)) {
      guardUids.delete(uid);
      syncGuard();
    }
    return false;
  }

  function titlePanelOf(native) {
    for (const sibling of native.parentElement?.children || []) {
      if (sibling !== native && sibling.classList?.contains(TITLE_PANEL_CLASS)) return sibling;
    }
    return null;
  }

  function setFullscreen(rec, next) {
    rec.fullscreen = Boolean(next);
    try {
      rec.view?.setFullscreen?.(rec.fullscreen);
    } catch (error) {
      console.warn("[plexus-diagram] setFullscreen failed", error);
    }
  }

  // Enhanced diagram ancestors (root first) plus the board itself: the trail shown when a nested board is opened directly.
  function seedCrumbs(uid) {
    const self = { uid, title: boardTitle(host.blockString?.(uid)) };
    try {
      const res = host.api.data.pull(ANCESTORS_PATTERN, [":block/uid", uid]);
      const parents = res?.[":block/parents"] ?? [];
      const chain = parents
        .filter((p) => isDiagramString(pulledString(p)) && readPlexus(p[":block/props"] ?? p.props)?.v === 2)
        .map((p) => ({ uid: p[":block/uid"], title: boardTitle(p[":block/string"]), depth: (p[":block/parents"] ?? []).length }))
        .sort((a, b) => a.depth - b.depth)
        .map(({ uid: u, title }) => ({ uid: u, title }));
      return [...chain, self];
    } catch {
      return [self];
    }
  }

  const isDiagramUid = (candidate) => isDiagramString(host.blockString?.(candidate));
  // An element id always names the same block, so the split is resolved once per id.
  const inputUids = new Map();
  isDiagramUid.many = (candidates) => {
    const key = candidates[candidates.length - 1] || "";
    const known = inputUids.get(key);
    if (known !== undefined) return known && isDiagramUid(known) ? known : null;
    const strings = host.blockStrings?.(candidates);
    if (!strings) return candidates.find((candidate) => isDiagramUid(candidate)) ?? null;
    const uid = candidates.find((candidate) => strings.get(candidate) != null) || "";
    if (inputUids.size > 5000) inputUids.clear();
    inputUids.set(key, uid);
    return uid && isDiagramString(strings.get(uid)) ? uid : null;
  };

  // A nested board that mounted before this parent claimed its rendered children is an outline copy.
  function unmountOutlineCopies(parent) {
    for (const other of [...mounts.values()]) {
      if (other !== parent && insideEnhancedOutline(other.native)) unmount(other);
    }
  }

  // Roam skips a collapsed block's children (not rendered, skipped by keyboard navigation), so the board block
  // is collapsed instead of hiding its outline. Once per board and graph: the user may expand it on purpose.
  // Passive mounts (hover previews, popovers) never write: the collapse would land on Roam's undo stack unasked.
  function collapseOnce(uid, native) {
    if (settings[SETTING_IDS.collapseOutline] === false || !storage?.getItem || !storage?.setItem) return;
    if (native?.closest?.(".bp3-portal")) return;
    const key = `plexus-diagram:collapsed:${graphFromHash()}:${uid}`;
    let state;
    try {
      if (storage.getItem(key)) return;
      state = host.api.data.pull("[:block/open]", [":block/uid", uid]);
      if (!state) return;
      storage.setItem(key, "1"); // set BEFORE the write so a failure never loops
    } catch { return; }
    if (state[":block/open"] === false) return;
    Promise.resolve()
      .then(() => host.setOpen(uid, false))
      .catch((error) => console.warn("[plexus-diagram] Could not collapse the board block", uid, error));
  }

  // A virtual board folds with its first write (the session stamps it). Remember that so a later mount does not fold again.
  function markCollapsed(uid) {
    if (!storage?.setItem) return;
    try { storage.setItem(`plexus-diagram:collapsed:${graphFromHash()}:${uid}`, "1"); } catch { /* storage is a cache only */ }
  }

  function sketchGesturing(rec) {
    return rec?.view?.root?.classList?.contains?.("pxd-root--gesturing") === true;
  }

  function clearSketchTimer(rec) {
    const timer = sketchTimers.get(rec);
    if (timer) clearTimeout(timer);
    sketchTimers.delete(rec);
  }

  function storedSketchViewport(rec, uid) {
    try {
      const id = viewportStorageId(rec?.native, uid, (blockId) => host.blockString?.(blockId));
      let stored = host.viewports?.get?.(id) || null;
      if (!stored && id !== uid && String(id).startsWith(`${uid}:embed:`)) stored = host.viewports?.get?.(uid) || null;
      return stored;
    } catch { return null; }
  }

  function sketchMountSize(rec) {
    const box = rec?.mountEl?.getBoundingClientRect?.();
    if (box && box.width > 0 && box.height > 0) return { width: box.width, height: box.height };
    return null;
  }

  // The absolute sketch needs the mount as its containing block. Leave a positioned mount alone.
  function anchorMount(mountEl) {
    const pos = mountEl?.style?.position;
    if (mountEl?.style && (pos == null || pos === "" || pos === "static")) mountEl.style.position = "relative";
  }

  function showSketch(rec, initialViewport) {
    if (speedFlags().sketch === false) return null;
    try {
      const uid = currentUid(rec);
      const sketch = sketchStore.get(uid);
      if (!sketch?.items?.length && !sketch?.edges?.length) return null;
      const vp = resolveSketchViewport({
        stored: storedSketchViewport(rec, uid),
        initial: initialViewport,
        board: rec.session?.board,
        size: sketchMountSize(rec),
      });
      anchorMount(rec.mountEl);
      const layer = paintSketch(doc, rec.mountEl, sketch, vp, { inset: rec.fullscreen ? 0 : SKETCH_ROOT_BORDER });
      return layer ? vp : null;
    } catch {
      try { removeSketch(rec?.mountEl); } catch { /* the live mount still proceeds */ }
      return null;
    }
  }

  function forgetSketch(rec) {
    if (!rec) return;
    clearSketchTimer(rec);
    cancelSketchHandoff(rec);
  }

  // A stand-in is not a settled board. Saves wait until the live view is in.
  function liveSketchView(rec) {
    return Boolean(rec?.view) && rec.view.sketchStandIn !== true;
  }

  function writeSketch(rec) {
    sketchTimers.delete(rec);
    if (speedFlags().sketch === false) return;
    if (stopped || !rec || mounts.get(rec.native) !== rec || !liveSketchView(rec) || !rec.session?.board) return;
    if (sketchGesturing(rec)) { scheduleSketch(rec); return; }
    try {
      const sketch = captureSketch(rec.session.board);
      const uid = currentUid(rec);
      if (sketch && uid) sketchStore.set(uid, sketch);
    } catch { /* a bad board must not throw out of the timer */ }
  }

  function scheduleSketch(rec) {
    clearSketchTimer(rec);
    if (speedFlags().sketch === false) return;
    if (stopped || !rec || mounts.get(rec.native) !== rec || !liveSketchView(rec)) return;
    const timer = setTimeout(() => writeSketch(rec), SKETCH_DEBOUNCE_MS);
    timer.unref?.();
    sketchTimers.set(rec, timer);
  }

  function saveSketchNow(rec) {
    clearSketchTimer(rec);
    if (speedFlags().sketch === false) return;
    if (!rec?.view || !rec.session?.board || sketchGesturing(rec)) return;
    try {
      const sketch = captureSketch(rec.session.board);
      const uid = currentUid(rec);
      if (!sketch || !uid) return;
      sketchStore.set(uid, sketch);
      sketchStore.flushAll();
    } catch { /* storage is optional */ }
  }

  const SKETCH_INPUT = ["keydown", "keyup", "pointerdown", "pointerup"];

  function clearSketchHandoffTimers(handoff) {
    if (!handoff) return;
    if (handoff.rafId != null) {
      try { globalThis.cancelAnimationFrame?.(handoff.rafId); } catch { /* stub */ }
      handoff.rafId = null;
    }
    if (handoff.holdRaf != null) {
      try { globalThis.cancelAnimationFrame?.(handoff.holdRaf); } catch { /* stub */ }
      handoff.holdRaf = null;
    }
    for (const key of ["timeoutId", "holdTimer", "soonTimer"]) {
      if (handoff[key] == null) continue;
      clearTimeout(handoff[key]);
      handoff[key] = null;
    }
  }

  function detachSketchInput(handoff) {
    const fn = handoff?.onEvent;
    if (!fn) return;
    handoff.onEvent = null;
    if (typeof handoff.win?.removeEventListener !== "function") return;
    for (const type of SKETCH_INPUT) {
      try { handoff.win.removeEventListener(type, fn, true); } catch { /* already gone */ }
    }
  }

  function cancelSketchHandoff(rec) {
    const handoff = rec ? sketchHandoffs.get(rec) : null;
    if (handoff) {
      handoff.cancelled = true;
      sketchHandoffs.delete(rec);
      clearSketchHandoffTimers(handoff);
      detachSketchInput(handoff);
      try { handoff.observer?.disconnect?.(); } catch { /* already gone */ }
      handoff.observer = null;
    }
    if (rec) try { removeSketch(rec.mountEl); } catch { /* already gone */ }
  }

  // Only input aimed at this board's own mount is held. Typing in a Roam block or clicking
  // elsewhere while a board loads must reach Roam untouched.
  function sketchHandoffOwns(handoff, event) {
    const mount = handoff.rec?.mountEl;
    const target = event?.target;
    return Boolean(target && mount?.contains?.(target));
  }

  function snapshotSketchEvent(event) {
    return {
      type: event.type,
      key: event.key,
      code: event.code,
      repeat: event.repeat,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      button: event.button,
      buttons: event.buttons,
      clientX: event.clientX,
      clientY: event.clientY,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      target: event.target ?? null,
    };
  }

  function makeSketchEvent(snap) {
    const init = { bubbles: true, cancelable: true };
    for (const key of ["key", "code", "repeat", "shiftKey", "altKey", "metaKey", "ctrlKey", "button", "buttons", "clientX", "clientY", "pointerId", "pointerType"]) {
      if (snap[key] != null) init[key] = snap[key];
    }
    const Ctor = String(snap.type || "").startsWith("key") ? globalThis.KeyboardEvent
      : String(snap.type || "").startsWith("pointer") ? globalThis.PointerEvent
      : globalThis.MouseEvent;
    if (typeof Ctor === "function") {
      try { return new Ctor(snap.type, init); } catch { /* plain event below */ }
    }
    return {
      ...init,
      type: snap.type,
      preventDefault() {},
      stopPropagation() {},
      stopImmediatePropagation() {},
    };
  }

  function attachSketchInput(handoff) {
    handoff.queue = [];
    const fn = (event) => {
      if (!event || handoff.cancelled || handoff.mounted) return;
      if (!sketchHandoffOwns(handoff, event)) return;
      handoff.queue.push(snapshotSketchEvent(event));
      try { event.stopPropagation?.(); } catch { /* frozen event */ }
      try { event.stopImmediatePropagation?.(); } catch { /* frozen event */ }
    };
    handoff.onEvent = fn;
    if (typeof handoff.win?.addEventListener !== "function") return;
    for (const type of SKETCH_INPUT) {
      try { handoff.win.addEventListener(type, fn, true); } catch { /* the window cannot listen */ }
    }
  }

  function replaySketchInput(handoff, view) {
    const queued = handoff.queue?.splice(0) || [];
    for (const snap of queued) {
      const keyEvent = String(snap.type || "").startsWith("key");
      // Board keys listen on window in capture phase; pointers go to the live root.
      const target = keyEvent
        ? handoff.win
        : (typeof view?.root?.dispatchEvent === "function" ? view.root : handoff.rec?.mountEl);
      if (typeof target?.dispatchEvent !== "function") continue;
      try { target.dispatchEvent(makeSketchEvent(snap)); } catch { /* replay is best-effort */ }
    }
  }

  function sketchStandIn(handoff) {
    const queued = [];
    const call = (name, args) => {
      const live = handoff.view;
      if (live && typeof live[name] === "function") return live[name](...args);
      queued.push([name, args]);
    };
    handoff.flushQueued = () => {
      const live = handoff.view;
      if (!live) return;
      for (const [name, args] of queued.splice(0)) {
        try { live[name]?.(...args); } catch { /* the live view rejected a queued call */ }
      }
    };
    return {
      sketchStandIn: true,
      get root() { return handoff.view?.root ?? null; },
      viewport() {
        try { return handoff.view?.viewport?.() ?? handoff.vp ?? null; } catch { return handoff.vp ?? null; }
      },
      state() { try { return handoff.view?.state?.() ?? null; } catch { return null; } },
      cameraRect() { try { return handoff.view?.cameraRect?.() ?? null; } catch { return null; } },
      dispose() {
        queued.length = 0;
        const live = handoff.view;
        handoff.view = null;
        cancelSketchHandoff(handoff.rec);
        try { live?.dispose?.(); } catch { /* already gone */ }
      },
      setSettings(value) { call("setSettings", [value]); },
      setFullscreen(value) { call("setFullscreen", [value]); },
      focusUid(uid) { return call("focusUid", [uid]); },
      applyShow(spec) { call("applyShow", [spec]); },
      quiet(on) { call("quiet", [on]); },
    };
  }

  function armSketchHold(handoff) {
    const rec = handoff.rec;
    const finish = () => cancelSketchHandoff(rec);
    const look = () => {
      if (handoff.cancelled || handoff.holdRaf != null || handoff.soonTimer != null) return;
      if (!rec.mountEl?.querySelector?.(".pxd-item")) return;
      try { handoff.observer?.disconnect?.(); } catch { /* already gone */ }
      handoff.observer = null;
      const raf = globalThis.requestAnimationFrame;
      if (typeof raf === "function") {
        handoff.holdRaf = raf(() => {
          handoff.holdRaf = null;
          finish();
        });
        return;
      }
      const timer = setTimeout(() => {
        handoff.soonTimer = null;
        finish();
      }, 0);
      timer.unref?.();
      handoff.soonTimer = timer;
    };
    look();
    if (!handoff.cancelled && handoff.holdRaf == null && handoff.soonTimer == null && typeof MutationObserver === "function" && rec.mountEl) {
      try {
        const observer = new MutationObserver(look);
        observer.observe(rec.mountEl, { childList: true, subtree: true });
        handoff.observer = observer;
      } catch { /* the 2s timeout still removes the sketch */ }
    }
    const timer = setTimeout(() => {
      handoff.holdTimer = null;
      finish();
    }, SKETCH_HOLD_MS);
    timer.unref?.();
    handoff.holdTimer = timer;
  }

  function callMountView(rec, autofocus, viewport) {
    return mountView({
      host,
      session: rec.session,
      mountEl: rec.mountEl,
      nativeEl: rec.native,
      settings,
      fullscreen: rec.fullscreen,
      version: badge,
      onRequestFullscreen: (want) => setFullscreen(rec, want === undefined ? !rec.fullscreen : want),
      crumbs: rec.crumbs.slice(),
      routeUid: rec.uid,
      autofocus,
      initialViewport: viewport,
      onOpenBoard: (child) => visit(rec, [...rec.crumbs, { uid: child, title: boardTitle(host.blockString?.(child)) }]),
      onCrumb: (index) => visit(rec, rec.crumbs.slice(0, index + 1)),
      onHistoryBack: () => historyMove(rec, "back"),
      onHistoryForward: () => historyMove(rec, "forward"),
      onSetDefaults: (patch) => setDefaults(patch),
      perfLog,
      lifecycle,
    });
  }

  function finishLive(rec, view, logging, t0) {
    rec.view = view;
    try { scheduleSketch(rec); } catch { /* the live board is already up */ }
    if (logging) perfLog.watchOpen(rec.mountEl, t0);
    return view;
  }

  function runSketchMount(handoff, standIn, { autofocus, viewport, logging, t0 }) {
    const rec = handoff.rec;
    if (handoff.cancelled || stopped || mounts.get(rec.native) !== rec) return;
    handoff.mounted = true;
    detachSketchInput(handoff);
    let view;
    try {
      view = callMountView(rec, autofocus, viewport);
    } catch (error) {
      handoff.cancelled = true;
      clearSketchHandoffTimers(handoff);
      detachSketchInput(handoff);
      sketchHandoffs.delete(rec);
      try { removeSketch(rec.mountEl); } catch { /* already gone */ }
      try {
        noteMountFail(currentUid(rec), error);
        unmount(rec);
      } catch { /* already down */ }
      return;
    }
    if (handoff.cancelled || stopped || mounts.get(rec.native) !== rec || rec.view !== standIn) {
      try { view?.dispose?.(); } catch { /* already gone */ }
      try { removeSketch(rec.mountEl); } catch { /* already gone */ }
      return;
    }
    handoff.view = view;
    try { handoff.flushQueued?.(); } catch { /* a queued call can fail closed */ }
    if (handoff.cancelled || stopped || mounts.get(rec.native) !== rec || rec.view !== standIn) {
      try { view?.dispose?.(); } catch { /* already gone */ }
      try { removeSketch(rec.mountEl); } catch { /* already gone */ }
      return;
    }
    finishLive(rec, view, logging, t0);
    replaySketchInput(handoff, view);
    try { armSketchHold(handoff); } catch { cancelSketchHandoff(rec); }
  }

  function beginSketchHandoff(rec, vp, opts) {
    const handoff = {
      rec,
      vp,
      win,
      cancelled: false,
      mounted: false,
      queue: [],
      view: null,
      rafId: null,
      timeoutId: null,
      holdRaf: null,
      holdTimer: null,
      soonTimer: null,
      observer: null,
    };
    sketchHandoffs.set(rec, handoff);
    const standIn = sketchStandIn(handoff);
    rec.view = standIn;
    attachSketchInput(handoff);
    const start = () => {
      handoff.timeoutId = null;
      runSketchMount(handoff, standIn, opts);
    };
    const raf = globalThis.requestAnimationFrame;
    if (typeof raf === "function") {
      handoff.rafId = raf(() => {
        handoff.rafId = null;
        if (handoff.cancelled || stopped || mounts.get(rec.native) !== rec) return;
        const timer = setTimeout(start, 0);
        timer.unref?.();
        handoff.timeoutId = timer;
      });
    } else {
      const timer = setTimeout(start, 0);
      timer.unref?.();
      handoff.timeoutId = timer;
    }
    return standIn;
  }

  // Wake and nested opens both come through here. The clock starts at entry.
  // A stored sketch paints in this turn, then one frame and a macrotask pass
  // before mountView, so the browser can show it. The sketch stays until the
  // live world has a .pxd-item and one more frame, or SKETCH_HOLD_MS. It is
  // not a .pxd-item, so the open sample still waits for a live card.
  // No sketch: mount in this turn.
  function mountRecView(rec, { autofocus = false, viewport = null } = {}) {
    speedFlags();
    const logging = settings[SETTING_IDS.speedLog] === true;
    const t0 = logging ? perfNow() : 0;
    cancelSketchHandoff(rec);
    const vp = showSketch(rec, viewport);
    if (!vp) {
      let view;
      try {
        view = callMountView(rec, autofocus, viewport);
      } catch (error) {
        removeSketch(rec.mountEl);
        throw error;
      }
      removeSketch(rec.mountEl);
      const live = finishLive(rec, view, logging, t0);
      if (logging) shiftWatch.watchMount(rec.mountEl);
      return live;
    }
    if (logging) shiftWatch.watchMount(rec.mountEl);
    return beginSketchHandoff(rec, vp, { autofocus, viewport, logging, t0 });
  }

  async function setDefaults(patch) {
    if (stopped || !patch || typeof patch !== "object") return;
    for (const [id, value] of Object.entries(patch)) {
      try {
        await extensionAPI.settings?.set?.(id, value);
      } catch (error) {
        console.warn("[plexus-diagram] Could not save setting", id, error);
      }
      if (stopped) return;
      settings = { ...settings, [id]: normalizeSetting(id, value) };
    }
    for (const rec of [...mounts.values()]) {
      try {
        if (typeof rec.view?.setSettings === "function") rec.view.setSettings(settings);
      } catch (error) {
        console.warn("[plexus-diagram] Settings propagation failed", error);
      }
    }
  }

  function watchRec(rec) {
    const session = rec.session;
    const offGone = session.on?.("gone", () => {
      dropBoardCards(session.board?.uid || currentUid(rec));
      if (currentUid(rec) !== rec.uid) popSilent(rec);
      else unmount(rec);
    });
    const offChange = session.on?.("change", (diff) => {
      scheduleSketch(rec);
      if (diff?.structural && session.board) {
        relChips.noteBoard(session.board);
        publishCards(session.board);
        publicEmit("change", { boardUid: session.board.uid });
      }
      // Restore (or an external props edit / undo) removed :plexus: give the native diagram back.
      if (!session.board || session.board.enhanced !== false) return;
      if (currentUid(rec) !== rec.uid) {
        popSilent(rec);
      } else if (!legacyUids.has(rec.uid)) {
        markNative(rec.uid);
        unmount(rec);
      }
    });
    return () => { offGone?.(); offChange?.(); };
  }

  function forgetUid(rec, uid) {
    const keep = (entry) => entry.crumbs[entry.crumbs.length - 1]?.uid !== uid;
    rec.back = (rec.back || []).filter(keep);
    rec.forward = (rec.forward || []).filter(keep);
  }

  // A vanished nested board steps up without becoming a forward entry.
  function popSilent(rec) {
    const gone = currentUid(rec);
    if (gone === rec.uid) return;
    forgetUid(rec, gone);
    navigate(rec, rec.crumbs.slice(0, -1), null);
  }

  // "Open on board" for a connection: open the page's board (a link's ?pxd= is dropped by Roam before a board that is
  // not mounted yet could read it, so the target waits here), enter a nested board through the normal navigation
  // (crumbs, history), then select the connection. If the root board never mounts, open the board block itself.
  let pendingNest = null; // { root, trail, edgeUid, boardUid, until }
  function enterNested(rec, trail, edgeUid) {
    visit(rec, trail);
    // The board's data may still be loading right after a mount: retry for about a second.
    const focus = (left) => {
      if (stopped || mounts.get(rec.native) !== rec) return;
      let done = false;
      try { done = Boolean(rec.view?.focusUid?.(edgeUid)); } catch { done = false; }
      if (!done && left > 0) lifecycle.timeout(() => focus(left - 1), 150);
    };
    queueMicrotask(() => focus(8));
  }
  function resumeNestedOpen(rec) {
    const p = pendingNest;
    if (!p || p.root !== rec.uid || !rec.view || Date.now() > p.until) return;
    pendingNest = null;
    enterNested(rec, p.trail, p.edgeUid);
  }
  function openNestedConnection(boardUid, edgeUid) {
    if (stopped || !boardUid || !edgeUid) return false;
    const trail = seedCrumbs(boardUid);
    const root = trail[0].uid;
    for (const rec of mounts.values()) {
      if (rec.uid === root && rec.view) { enterNested(rec, trail, edgeUid); return true; }
    }
    let pageUid = "";
    try { pageUid = host.blockPageUid?.(boardUid) || ""; } catch { pageUid = ""; }
    if (!pageUid) { try { void host.openBlock?.(boardUid); } catch { /* host unavailable */ } return true; }
    pendingNest = { root, trail, edgeUid, boardUid, until: Date.now() + 8000 };
    const mine = pendingNest;
    lifecycle.timeout(() => {
      if (pendingNest !== mine) return;
      pendingNest = null;
      try { void host.openBlock?.(boardUid); } catch { /* host unavailable */ }
    }, 6000);
    assignDeepLink(globalThis.location, { graph: host.graph || graphFromHash(), pageUid, cardUid: root }, () => {
      try { win.dispatchEvent?.(new Event("hashchange")); } catch { /* already there */ }
    });
    return true;
  }

  // User navigation. History commits only after the target board actually opens.
  function visit(rec, next) {
    if (stopped || mounts.get(rec.native) !== rec || !next?.length) return;
    if (next[next.length - 1].uid === currentUid(rec)) return;
    const backTop = rec.back?.[rec.back.length - 1];
    const fore = rec.forward?.[rec.forward.length - 1];
    let mode = "push";
    let destVp = null;
    if (backTop && sameTrail(backTop.crumbs, next)) { mode = "back"; destVp = backTop.vp; }
    else if (fore && sameTrail(fore.crumbs, next)) { mode = "forward"; destVp = fore.vp; }
    const leaving = shot(rec);
    navigate(rec, next, destVp, () => {
      if (mode === "back") { rec.forward.push(leaving); rec.back.pop(); }
      else if (mode === "forward") { rec.back.push(leaving); rec.forward.pop(); }
      else { rec.back.push(leaving); rec.forward = []; }
    });
  }

  function historyMove(rec, dir) {
    if (stopped || mounts.get(rec.native) !== rec) return false;
    const from = dir === "back" ? rec.back : rec.forward;
    if (!from?.length) return false;
    const dest = from[from.length - 1];
    const leaving = shot(rec);
    navigate(rec, dest.crumbs, dest.vp, () => {
      from.pop();
      (dir === "back" ? rec.forward : rec.back).push(leaving);
    });
    return true;
  }

  // Per window, keyed by mount + board uid so the main column and the sidebar
  // never share a view. Only navigate parks a canvas here. Hibernate disposes it.
  const kept = [];

  // A canvas we can lift off the document. A sketch stand-in, a fullscreen board,
  // a board that holds focus, or a view with no root is disposed instead.
  function canKeep(rec) {
    if (speedFlags().keepAlive === false) return false;
    const view = rec?.view;
    if (!view || view.sketchStandIn === true) return false;
    if (rec.fullscreen || holdsFocus(rec)) return false;
    const root = view.root;
    return Boolean(root && typeof root.remove === "function");
  }

  function disarm(rec) {
    try { rec.off?.(); } catch { /* ignore */ }
    rec.off = null;
  }

  function disposePair(view, session, paused) {
    try { view?.dispose?.(); } catch (error) { console.warn("[plexus-diagram] view dispose failed", error); }
    try {
      if (paused) session?.release?.({ paused: true });
      else session?.release?.();
    } catch (error) { console.warn("[plexus-diagram] session release failed", error); }
  }

  function dropKept(entry) {
    const at = kept.indexOf(entry);
    if (at >= 0) kept.splice(at, 1);
    if (entry.timer != null) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    disposePair(entry.view, entry.session, true);
  }

  function dropKeptFor(rec) {
    for (const entry of kept.filter((item) => item.rec === rec)) dropKept(entry);
  }

  function trimKept() {
    while (kept.length > KEEP_ALIVE_CAP) dropKept(kept[0]);
  }

  function remember(rec, uid, view, session) {
    for (const entry of kept.filter((item) => item.rec === rec && item.uid === uid)) dropKept(entry);
    const entry = { rec, uid, view, session, timer: null };
    entry.timer = setTimeout(() => {
      entry.timer = null;
      if (kept.includes(entry)) dropKept(entry);
    }, KEEP_ALIVE_MS);
    try { entry.timer.unref?.(); } catch { /* a fake timer has no unref */ }
    kept.push(entry);
    trimKept();
  }

  function suspendView(view) {
    try { view?.suspend?.(); } catch { /* observers are best-effort */ }
    try { view?.root?.remove?.(); } catch { /* already off the document */ }
  }

  function resumeView(rec, view) {
    const root = view?.root;
    if (typeof view?.rebind === "function" && rec.mountEl) {
      try { view.rebind(rec.mountEl); } catch { /* the mount is gone */ }
    } else if (root && rec.mountEl && root.parentElement !== rec.mountEl) {
      try { rec.mountEl.append(root); } catch { /* the mount is gone */ }
    }
    try { view?.resume?.(); } catch { /* already live */ }
  }

  // Roam page navigation removes the native element. The current canvas stays off
  // the document, one per board and kind, until that same diagram comes back.
  // The crumb pool above is separate: it is keyed by the mount that is still on the page.
  const alive = [];

  function poolKind(native) {
    if (inRightSidebar(native)) return "sidebar";
    try {
      if (embedOwnerUid(native, (id) => host.blockString?.(id))) return "embed";
    } catch { /* a host without block strings is a main board */ }
    return "main";
  }

  function pageLeft(rec) {
    return rec?.native?.isConnected === false || rec?.mountEl?.isConnected === false;
  }

  function fullscreenPinned(rec) {
    if (rec?.fullscreen) return true;
    const uid = rec?.uid;
    const shown = currentUid(rec);
    for (const other of mounts.values()) {
      if (other === rec || !other.fullscreen) continue;
      if (other.native?.isConnected === false || other.mountEl?.isConnected === false) continue;
      if (other.uid === uid || other.uid === shown || currentUid(other) === uid || currentUid(other) === shown) return true;
    }
    return false;
  }

  function canPool(rec) {
    if (speedFlags().keepAlive === false) return false;
    if (stopped || !rec || fullscreenPinned(rec)) return false;
    const view = rec.view;
    if (!view || view.sketchStandIn === true || typeof view.suspend !== "function") return false;
    if (!view.root || typeof view.root.remove !== "function") return false;
    if (!rec.session?.board) return false;
    return true;
  }

  function aliveUsable(pooled) {
    return Boolean(pooled?.session?.board && pooled.view?.root && pooled.view.sketchStandIn !== true);
  }

  function dropAlive(entry) {
    const at = alive.indexOf(entry);
    if (at >= 0) alive.splice(at, 1);
    if (entry.timer != null) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    disposePair(entry.view, entry.session, true);
  }

  function trimAlive() {
    while (alive.length > KEEP_ALIVE_CAP) dropAlive(alive[0]);
  }

  function rememberAlive(rec, viewport, crumbs) {
    const boardUid = rec.uid;
    const kind = rec.poolKind || poolKind(rec.native);
    for (const entry of alive.filter((item) => item.boardUid === boardUid && item.kind === kind)) dropAlive(entry);
    const entry = { view: rec.view, session: rec.session, boardUid, kind, viewport, crumbs, timer: null };
    entry.timer = setTimeout(() => {
      entry.timer = null;
      if (alive.includes(entry)) dropAlive(entry);
    }, KEEP_ALIVE_MS);
    try { entry.timer.unref?.(); } catch { /* a fake timer has no unref */ }
    alive.push(entry);
    trimAlive();
  }

  function takeAlive(boardUid, kind) {
    const at = alive.findIndex((entry) => entry.boardUid === boardUid && entry.kind === kind);
    if (at < 0) return null;
    const entry = alive[at];
    alive.splice(at, 1);
    if (entry.timer != null) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    return entry;
  }

  function disposeAlive() {
    for (const entry of [...alive]) dropAlive(entry);
  }

  // Same view root in the new mount. No sketch, no mountRecView. One pull on resume.
  function adoptAlive(rec, pooled) {
    rec.session = pooled.session;
    if (pooled.crumbs?.length) rec.crumbs = crumbCopy(pooled.crumbs);
    rec.view = pooled.view;
    resumeView(rec, pooled.view);
    try { pooled.view?.restoreViewport?.(pooled.viewport); } catch { /* the camera is optional */ }
    try { pooled.view?.setSettings?.(settings); } catch { /* settings are optional */ }
    try { rec.session?.resumeWatches?.(); } catch { /* the watch is already live */ }
    rec.off = watchRec(rec);
    publishCards(rec.session?.board);
    try { scheduleSketch(rec); } catch { /* the live board is already up */ }
    if (settings[SETTING_IDS.speedLog] === true) perfLog.watchOpen(rec.mountEl, perfNow());
  }

  function claimAlive(rec, boardUid, native) {
    const pooled = takeAlive(boardUid, poolKind(native));
    if (aliveUsable(pooled)) {
      adoptAlive(rec, pooled);
      return true;
    }
    if (pooled) disposePair(pooled.view, pooled.session, true);
    return false;
  }

  // Park the showing canvas. The pool holds its session ref, so release is not called.
  function detachCurrent(rec) {
    const view = rec.view;
    const session = rec.session;
    const uid = currentUid(rec);
    const keep = canKeep(rec);
    disarm(rec);
    rec.view = null;
    rec.session = null;
    if (!keep || !uid || !view || !session) {
      disposePair(view, session, false);
      return;
    }
    try { session.pauseWatches?.(); } catch { /* a session without watches just stays held */ }
    suspendView(view);
    remember(rec, uid, view, session);
  }

  function takeKept(rec, uid) {
    const at = kept.findIndex((entry) => entry.rec === rec && entry.uid === uid);
    if (at < 0) return null;
    const entry = kept[at];
    kept.splice(at, 1);
    if (entry.timer != null) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    return entry;
  }

  // Same view root, no sketch and no mountRecView. The open sample is this turn.
  function reattach(rec, view) {
    rec.view = view;
    resumeView(rec, view);
    try { view?.setSettings?.(settings); } catch { /* settings are optional */ }
    try { rec.session?.resumeWatches?.(); } catch { /* the watch is already live */ }
    rec.off = watchRec(rec);
    publishCards(rec.session?.board);
    try { scheduleSketch(rec); } catch { /* the live board is already up */ }
    if (settings[SETTING_IDS.speedLog] === true) perfLog.watchOpen(rec.mountEl, perfNow());
  }

  // In-place navigation between nested boards: same mount element, native surface and fullscreen state,
  // only the view and session are swapped. Deferred so the old view's handler stack unwinds first.
  // `commit` records history only once the target session is in hand.
  // Leaving a board detaches its view when it can be kept. Coming back reattaches that view.
  function navigate(rec, next, viewport, commit) {
    queueMicrotask(() => {
      if (stopped || mounts.get(rec.native) !== rec || !next.length) return;
      const target = next[next.length - 1].uid;
      if (target === currentUid(rec)) return;
      const virtual = !readEnhanced(host.api, target) && autoKind(target) === "virtual";
      if (!virtual && !readEnhanced(host.api, target)) {
        // Never enhance a native diagram from here; Roam opens it.
        try { Promise.resolve(host.openBlock?.(target)).catch(() => {}); } catch { /* host unavailable */ }
        return;
      }
      let pooled = takeKept(rec, target);
      if (pooled && !pooled.session?.board) {
        disposePair(pooled.view, pooled.session, true);
        pooled = null;
      }
      if (pooled) {
        try { commit?.(); } catch { /* history is optional */ }
        saveSketchNow(rec);
        forgetSketch(rec);
        detachCurrent(rec);
        rec.session = pooled.session;
        rec.crumbs = next;
        try {
          reattach(rec, pooled.view);
        } catch (error) {
          noteMountFail(rec.uid, error);
          unmount(rec);
        }
        return;
      }
      let session;
      try {
        session = acquireSession(target, { host, settings: liveSettings, ...virtualOptions(virtual) });
      } catch (error) {
        console.warn("[plexus-diagram] Could not open the nested board", error);
        return;
      }
      if (!session?.board) {
        session?.release?.();
        return;
      }
      try { commit?.(); } catch { /* history is optional */ }
      saveSketchNow(rec);
      forgetSketch(rec);
      detachCurrent(rec);
      rec.session = session;
      rec.crumbs = next;
      try {
        rec.view = mountRecView(rec, { autofocus: true, viewport: viewport || null });
        rec.off = watchRec(rec);
        publishCards(rec.session?.board);
      } catch (error) {
        noteMountFail(rec.uid, error);
        unmount(rec);
      }
    });
  }

  function mount(uid, native, { crumbs, virtual = false } = {}) {
    dropConvert(native);
    const mountEl = doc.createElement("div");
    mountEl.className = "pxd-mount";
    mountEl.dataset.diagramUid = uid;
    const titlePanel = titlePanelOf(native);
    setClassToken(native, OUTLINE_NATIVE_CLASS, false);
    setClassToken(titlePanel, OUTLINE_NATIVE_CLASS, false);
    const rec = {
      uid,
      native,
      mountEl,
      titlePanel,
      titleDisplay: titlePanel ? titlePanel.style.display : "",
      session: null,
      view: null,
      virtual,
      crumbs: crumbs ?? seedCrumbs(uid),
      back: [],
      forward: [],
      fullscreen: false,
      off: null,
      // Captured while the native is still connected. Page leave detaches it first.
      poolKind: poolKind(native),
    };
    setClassToken(native, NATIVE_HIDDEN_CLASS, true);
    if (titlePanel) titlePanel.style.display = "none";
    native.after(mountEl);
    mounts.set(native, rec);
    // A diagram inside the right sidebar is a copy in a window the user may never scroll to.
    // Leave a gap and let the viewport watcher build the canvas only when that window is on screen.
    if (inRightSidebar(native) && typeof IntersectionObserver === "function") {
      const h = native.getBoundingClientRect?.().height || 0;
      rec.mountEl.style.minHeight = `${Math.max(160, Math.round(h))}px`;
      rec.dormant = true;
      ensureViewportWatch();
      recByMount.set(mountEl, rec);
      viewportWatch?.observe(mountEl);
      applyVisibility(rec, sidebarWindows(), false);
      publicEmit("mount", { boardUid: uid });
      return rec;
    }
    try {
      if (!claimAlive(rec, uid, native)) {
        rec.session = acquireSession(currentUid(rec), { host, settings: liveSettings, ...virtualOptions(virtual) });
        rec.fullscreen = settings[SETTING_IDS.fullscreenOnZoom] !== false
          && !routeLeftZoomedDiagram(uid);
        rec.view = mountRecView(rec);
        rec.off = watchRec(rec);
        publishCards(rec.session?.board);
      } else {
        // A kept board left fullscreen when its page went away; a zoomed return puts it back.
        const wantFull = settings[SETTING_IDS.fullscreenOnZoom] !== false && !routeLeftZoomedDiagram(uid);
        if (wantFull !== Boolean(rec.fullscreen)) setFullscreen(rec, wantFull);
      }
    } catch (error) {
      noteMountFail(uid, error);
      unmount(rec);
      return null;
    }
    mountFail.delete(uid);
    unmountOutlineCopies(rec);
    resumeNestedOpen(rec);
    applyShow(rec);
    // An embed must not collapse the board. The original mount still does, once.
    if (rec.session?.board?.virtual) markCollapsed(uid);
    else if (!embedOwnerUid(native, (id) => host.blockString?.(id))) collapseOnce(uid, native);
    if (currentUid(rec) === uid) migrateLegacy(rec);
    ensureViewportWatch();
    recByMount.set(mountEl, rec);
    viewportWatch?.observe(mountEl);
    applyVisibility(rec, sidebarWindows(), false);
    publicEmit("mount", { boardUid: uid });
    return rec;
  }

  function migrateLegacy(rec) {
    const { uid, session } = rec;
    if (!legacyUids.has(uid) || readEnhanced(host.api, uid)) return;
    const key = `plexus-diagram:migrated:${graphFromHash()}:${uid}`;
    try {
      if (storage?.getItem?.(key)) return;
      storage?.setItem?.(key, "1"); // set BEFORE the call so a failure never loops
    } catch { /* fall through: without storage we still migrate once per load */ }
    if (rec.migrating) return;
    rec.migrating = true;
    Promise.resolve()
      .then(() => session.enhance())
      .then(() => markEnhanced(uid))
      .catch((error) => console.warn("[plexus-diagram] 0.6 import failed", uid, error));
  }

  function inRightSidebar(node) {
    for (let cur = node; cur; cur = cur.parentElement) {
      if (cur.id === "right-sidebar") return true;
      if (cur.classList?.contains?.("rm-sidebar-window") || cur.classList?.contains?.("rm-right-sidebar")) return true;
    }
    return false;
  }

  // An offscreen board still holds its card shells, and a keystroke is a Roam transaction
  // that walks that DOM. One viewport observer parks every mount (main page and sidebar)
  // as a sized gap. A collapsed sidebar window and a closed ancestor block are not
  // intersection changes, so reconcile parks those too. Card shells stay in offscreen.js.
  const recByMount = new WeakMap();
  let viewportWatch = null;
  let sidebarWatch = null;
  function holdsFocus(rec) {
    const active = doc.activeElement;
    if (!active) return false;
    if (rec.mountEl?.contains?.(active)) return true;
    try { return Boolean(rec.view?.root?.contains?.(active)); } catch { return false; }
  }
  function sidebarWindowEl(node) {
    for (let cur = node; cur; cur = cur.parentElement) {
      if (cur.classList?.contains?.("rm-sidebar-window")) return cur;
    }
    return null;
  }
  // Only ask Roam when a board sits in a sidebar window; reconcile runs every 400 ms.
  function sidebarWindows() {
    return null;
  }
  function sidebarWindowsFromApi() {
    let any = false;
    for (const rec of mounts.values()) {
      if (sidebarWindowEl(rec.native) || sidebarWindowEl(rec.mountEl)) { any = true; break; }
    }
    if (!any) return null;
    try {
      const list = host.api?.ui?.rightSidebar?.getWindows?.();
      return Array.isArray(list) ? list : null;
    } catch { return null; }
  }
  // The window header's caret says open or closed. Reading it costs nothing; asking Roam for
  // getWindows() on every 400 ms reconcile tick cost ~6 ms per tick with 140 sidebar windows.
  function windowIsCollapsed(win) {
    if (!win) return false;
    if (win.classList?.contains?.("rm-sidebar-window--collapsed") || win.classList?.contains?.("collapsed")) return true;
    for (const child of win.children || []) {
      if (!child.classList?.contains?.("window-headers")) continue;
      return Boolean(child.querySelector?.(".rm-caret")?.classList?.contains?.("rm-caret-closed"));
    }
    return false;
  }
  // The closed bullet sits on the block's own line, not in a nested board.
  function lineClosed(container) {
    for (const child of container.children || []) {
      if (!child.classList?.contains?.("rm-block-main") && !child.classList?.contains?.("rm-block__self")) continue;
      if (classWithin(child, "rm-bullet--closed") || classWithin(child, "rm-caret-closed")) return true;
    }
    return false;
  }
  function classWithin(node, name) {
    if (!node || node.classList?.contains?.("rm-block-children")) return false;
    if (node.classList?.contains?.(name)) return true;
    for (const child of node.children || []) {
      if (classWithin(child, name)) return true;
    }
    return false;
  }
  // The board's own block folds its outline. Only an ancestor fold hides the diagram.
  function ancestorClosed(node) {
    let own = false;
    for (let cur = node; cur; cur = cur.parentElement) {
      if (!cur.classList?.contains?.("roam-block-container")) continue;
      if (!own) { own = true; continue; }
      if (cur.classList.contains("rm-block--closed") || lineClosed(cur)) return true;
    }
    return false;
  }
  function hostHides(rec, windows) {
    const win = sidebarWindowEl(rec.native) || sidebarWindowEl(rec.mountEl);
    if (windowIsCollapsed(win, windows)) return true;
    return ancestorClosed(rec.native) || ancestorClosed(rec.mountEl);
  }
  function ensureViewportWatch() {
    if (viewportWatch || typeof IntersectionObserver !== "function") return;
    viewportWatch = new IntersectionObserver((entries) => {
      const windows = sidebarWindows();
      for (const entry of entries) {
        const rec = recByMount.get(entry.target);
        if (!rec || !mounts.has(rec.native)) continue;
        rec.seen = Boolean(entry.isIntersecting);
        // A hide collapses the box. That false reading is not "scrolled away".
        if (!hostHides(rec, windows)) rec.seenLive = rec.seen;
        applyVisibility(rec, windows, true);
      }
    }, { rootMargin: "60px" });
  }
  // fromObserver is the viewport callback. Reconcile only applies host hides,
  // so a board parked for leaving the viewport is not rebuilt on the next 400 ms pass.
  function applyVisibility(rec, windows, fromObserver) {
    if (!rec || stopped || !mounts.has(rec.native)) return;
    if (rec.fullscreen || holdsFocus(rec)) {
      if (rec.dormant) wake(rec);
      return;
    }
    const hidden = hostHides(rec, windows);
    if (hidden) {
      if (!rec.hostParked) {
        rec.seenBeforeHost = rec.seenLive === true || (rec.seenLive == null && Boolean(rec.view));
      }
      rec.hostParked = true;
      hibernate(rec, { force: true });
      return;
    }
    if (rec.hostParked) {
      rec.hostParked = false;
      const back = rec.seenBeforeHost === true || rec.seen === true;
      rec.seenBeforeHost = undefined;
      if (back) wake(rec);
      return;
    }
    if (!fromObserver) return;
    if (rec.seen === true) { if (rec.dormant) wake(rec); }
    else if (rec.seen === false) hibernate(rec);
  }
  function hibernate(rec, { force = false } = {}) {
    if (speedFlags().parking === false) return;
    if (!rec || rec.dormant || rec.fullscreen || !rec.view) return;
    if (holdsFocus(rec)) return;
    const height = rec.mountEl.getBoundingClientRect?.().height || 0;
    if (height < 40 && !force) return;
    const vp = cameraOf(rec);
    if (vp) rec.parkedVp = vp;
    rec.mountEl.style.minHeight = `${Math.max(40, Math.round(height))}px`;
    saveSketchNow(rec);
    forgetSketch(rec);
    try { rec.off?.(); } catch { /* ignore */ }
    rec.off = null;
    try { rec.view.dispose(); } catch (error) { console.warn("[plexus-diagram] hibernate failed", error); }
    try { rec.session?.release?.(); } catch (error) { console.warn("[plexus-diagram] session release failed", error); }
    rec.view = null;
    rec.session = null;
    rec.dormant = true;
    // Parking disposes the pool too. A scrolled-away mount holds no detached session.
    dropKeptFor(rec);
  }
  function wake(rec) {
    if (!rec || !rec.dormant || stopped || rec.mountEl.isConnected === false) return;
    rec.dormant = false;
    rec.mountEl.style.minHeight = "";
    try {
      if (!claimAlive(rec, rec.uid, rec.native)) {
        rec.session = acquireSession(currentUid(rec), { host, settings: liveSettings, ...virtualOptions(rec.virtual && virtualUids.has(currentUid(rec))) });
        if (!rec.session?.board) {
          rec.session?.release?.();
          unmount(rec);
          return;
        }
        rec.view = mountRecView(rec, { viewport: rec.parkedVp || null });
        rec.off = watchRec(rec);
        publishCards(rec.session?.board);
      }
      if (rec.session.board.virtual) markCollapsed(currentUid(rec));
      else if (!embedOwnerUid(rec.native, (id) => host.blockString?.(id))) collapseOnce(currentUid(rec), rec.native);
      if (currentUid(rec) === rec.uid) migrateLegacy(rec);
      applyShow(rec);
    } catch (error) {
      noteMountFail(currentUid(rec), error);
      unmount(rec);
    }
  }

  function unmount(rec) {
    if (!rec || !mounts.has(rec.native)) return;
    // A zoomed board opens fullscreen. Leaving the page leaves fullscreen first, so that board
    // can be kept too; fullscreen-on-zoom puts it back when the page returns.
    if (rec.fullscreen && pageLeft(rec) && rec.view && !rec.view.sketchStandIn) setFullscreen(rec, false);
    const keep = pageLeft(rec) && canPool(rec);
    const viewport = keep ? cameraOf(rec) : null;
    const crumbs = keep ? crumbCopy(rec.crumbs) : null;
    saveSketchNow(rec);
    forgetSketch(rec);
    viewportWatch?.unobserve(rec.mountEl);
    recByMount.delete(rec.mountEl);
    mounts.delete(rec.native);
    const boardUid = rec.session?.board?.uid || rec.uid;
    publicEmit("unmount", { boardUid });
    let still = false;
    for (const other of mounts.values()) {
      if (other.session?.board?.uid === boardUid) still = true;
    }
    if (!still && boardUid) {
      boardChips.dispose();
      boardChips.scan(doc?.body);
      cardChips.scan(doc?.body);
    }
    try { rec.off?.(); } catch { /* ignore */ }
    rec.off = null;
    dropKeptFor(rec);
    if (keep) {
      try { rec.session?.pauseWatches?.(); } catch { /* a session without watches just stays held */ }
      suspendView(rec.view);
      rememberAlive(rec, viewport, crumbs);
      rec.view = null;
      rec.session = null;
    } else {
      try { rec.view?.dispose?.(); } catch (error) { console.warn("[plexus-diagram] view dispose failed", error); }
      try { rec.session?.release?.(); } catch (error) { console.warn("[plexus-diagram] session release failed", error); }
    }
    rec.mountEl.remove();
    setClassToken(rec.native, NATIVE_HIDDEN_CLASS, false);
    if (rec.titlePanel) rec.titlePanel.style.display = rec.titleDisplay;
  }

  const uidByNative = new WeakMap();
  const outlineOwnerByNative = new WeakMap(); // native -> uid of the enhanced board whose outline it sits in

  // A .rm-diagram inside an enhanced ancestor board's outline is Roam's bullet copy of a card, never a board to mount.
  // Roots (zoomed block, sidebar window, block-ref embeds) have no enhanced ancestor container.
  function insideEnhancedOutline(native) {
    const cached = outlineOwnerByNative.get(native);
    if (cached) {
      if (isBoardEnhanced(cached)) return true;
      outlineOwnerByNative.delete(native);
    }
    const own = native.closest?.(BLOCK_CONTAINER_SELECTOR);
    let container = own ? own.parentElement?.closest?.(BLOCK_CONTAINER_SELECTOR) : null;
    while (container) {
      const uid = blockContainerUid(container, isDiagramUid);
      if (uid && isBoardEnhanced(uid)) {
        outlineOwnerByNative.set(native, uid);
        return true;
      }
      container = container.parentElement?.closest?.(BLOCK_CONTAINER_SELECTOR);
    }
    return false;
  }

  function dropConvert(native) {
    const hit = convertButtons.get(native);
    if (!hit) return;
    convertButtons.delete(native);
    hit.el.remove();
  }

  // Auto mode: a native diagram that already has shapes stays native, with one button that imports it.
  // Importing writes many blocks, so it never happens on open.
  function syncConvert(native, uid) {
    const want = Boolean(uid) && active() && settings[SETTING_IDS.autoEnhance] !== false
      && autoCache.get(uid)?.kind === "convert"
      && native.isConnected !== false
      && !native.closest?.(".bp3-portal")
      && !insideEnhancedOutline(native);
    if (!want) {
      dropConvert(native);
      return;
    }
    const have = convertButtons.get(native);
    if (have && have.uid === uid && have.el.isConnected !== false) return;
    dropConvert(native);
    const el = doc.createElement("button");
    el.type = "button";
    el.className = "pxd-convert pxd-convert--chip";
    el.textContent = CONVERT_LABEL;
    el.title = CONVERT_TITLE;
    el.addEventListener("pointerdown", (event) => event.stopPropagation?.());
    el.addEventListener("click", (event) => {
      event.preventDefault?.();
      event.stopPropagation?.();
      if (!active() || el.disabled) return;
      el.disabled = true;
      enhanceCommand({}, uid)
        .catch((error) => console.warn("[plexus-diagram] Enhance failed", error))
        .finally(() => { el.disabled = false; });
    });
    native.after(el);
    convertButtons.set(native, { el, uid });
  }

  function consider(native, options) {
    if (stopped || !native || mounts.has(native) || native.isConnected === false) return;
    if (!active()) {
      dropConvert(native);
      return;
    }
    // A native diagram nested inside a hidden native (or inside our own overlay) is not a board of its own.
    if (native.parentElement?.closest?.(".pxd-native-hidden, .pxd-root")) return;
    const readString = (id) => host.blockString?.(id);
    let uid = uidByNative.get(native);
    if (uid === undefined) {
      uid = findDiagramUidFromEl(native, isDiagramUid) || null;
      // An embed's nearest block input is often the embed block, not the board.
      if (!uid || !isBoardEnhanced(uid)) {
        const fromEmbed = embedBoardUid(native, readString);
        if (fromEmbed && isBoardEnhanced(fromEmbed)) uid = fromEmbed;
      }
      uidByNative.set(native, uid);
    }
    if (!uid || !isBoardEnhanced(uid)) {
      syncConvert(native, uid);
      return;
    }
    if (insideEnhancedOutline(native)) {
      // An outline copy stays native; exempt it from the pre-paint guard so its bullet is not blank.
      setClassToken(native, OUTLINE_NATIVE_CLASS, true);
      setClassToken(titlePanelOf(native), OUTLINE_NATIVE_CLASS, true);
      return;
    }
    // One plexus root per embed. A second .rm-diagram in that same copy stays native-hidden.
    const scope = embedScope(native, readString);
    if (scope) {
      for (const rec of mounts.values()) {
        if (embedScope(rec.native, readString) === scope) {
          setClassToken(native, NATIVE_HIDDEN_CLASS, true);
          return;
        }
      }
    }
    if (mountCooling(uid)) return;
    mount(uid, native, { ...options, virtual: virtualUids.has(uid) && !trusted.has(uid) });
  }

  function noteMountFail(uid, error) {
    const prev = mountFail.get(uid);
    const n = (prev?.n || 0) + 1;
    const wait = n <= MOUNT_BACKOFF_MS.length ? MOUNT_BACKOFF_MS[n - 1] : Infinity;
    mountFail.set(uid, { n, until: wait === Infinity ? Infinity : Date.now() + wait });
    if (!prev) console.warn("[plexus-diagram] Mount failed; native diagram restored", uid, error);
  }

  function mountCooling(uid) {
    const hit = mountFail.get(uid);
    return Boolean(hit && Date.now() < hit.until);
  }

  function outlineImage(uid) {
    if (!doc || !uid) return null;
    for (const node of doc.querySelectorAll(".roam-block-container")) {
      if (node.getAttribute?.("data-block-uid") !== uid) continue;
      const img = node.querySelector?.("img.rm-inline-img");
      if (img) return img;
    }
    return null;
  }

  function isSidebarMount(rec) {
    return inRightSidebar(rec.native) || inRightSidebar(rec.mountEl);
  }

  function allowShowMount(rec) {
    const sidebar = isSidebarMount(rec);
    if (showWhere === "sidebar") return sidebar;
    if (!sidebar) return true;
    const main = [...mounts.values()].some((other) => other !== rec && other.view && !isSidebarMount(other) && (other.uid === rec.uid || currentUid(other) === rec.uid || other.uid === currentUid(rec)));
    return !main;
  }

  function applyShow(rec) {
    const entry = showStash.peek();
    if (!entry || !rec?.view) return;
    if (!allowShowMount(rec)) return;
    // One stash entry is applied once per mount. Later wakes and hash changes must not snap the camera back.
    if (rec.shown === entry) return;
    let text = "";
    try { text = host.blockString?.(entry.uid) || ""; } catch { return; }
    const region = parseRegion(text);
    if (!region || region.owner !== "plexus-diagram" || region.supported !== true) return;
    if (region.kind === "img") {
      let hit = null;
      try { hit = host.showOnBoard?.(region.drawingUid) || null; } catch { hit = null; }
      if (!hit?.boardUid || !hit.cardUid) return;
      if (hit.boardUid !== currentUid(rec) && hit.boardUid !== rec.uid) return;
      rec.shown = entry;
      try { rec.view.applyShow?.({ kind: "img", f: region.f, cardUid: hit.cardUid }); } catch { /* view gone */ }
      return;
    }
    if (region.kind !== "view") return;
    const boardUid = region.drawingUid;
    if (boardUid !== currentUid(rec)) {
      const trail = seedCrumbs(boardUid);
      if (trail[0]?.uid === rec.uid && trail.length > 1) {
        rec.shown = entry;
        visit(rec, trail);
        queueMicrotask(() => {
          if (stopped || mounts.get(rec.native) !== rec) return;
          if (currentUid(rec) !== boardUid || !rec.view) return;
          try { rec.view.applyShow?.({ kind: "view", v: region.v, ids: region.ids || [] }); } catch { /* view gone */ }
        });
        return;
      }
      if (rec.uid !== boardUid && currentUid(rec) !== boardUid) return;
    }
    if (currentUid(rec) !== boardUid) return;
    rec.shown = entry;
    try { rec.view.applyShow?.({ kind: "view", v: region.v, ids: region.ids || [] }); } catch { /* view gone */ }
  }

  function applyShowAll() {
    for (const rec of [...mounts.values()]) applyShow(rec);
  }

  function revealMain(boardUid) {
    if (!boardUid) return;
    for (const rec of mounts.values()) {
      if (isSidebarMount(rec)) continue;
      if (rec.uid !== boardUid && currentUid(rec) !== boardUid) continue;
      try { (rec.mountEl || rec.native)?.scrollIntoView?.({ block: "center" }); } catch { /* no layout */ }
    }
  }

  function openPageUid() {
    try {
      const uid = host.api?.ui?.getOpenPageOrBlockUid?.() || "";
      if (uid) return uid;
    } catch { /* the hash is the fallback */ }
    return pageUidFromHash(globalThis.location?.hash || "");
  }

  function deepLinkTo(pageUid, cardUid) {
    assignDeepLink(globalThis.location, {
      graph: host.graph || graphFromHash(),
      pageUid,
      cardUid,
    }, () => applyShowAll());
  }

  function pulseOutline(img, frac) {
    if (!img || !doc) return;
    const ms = motionProfile(resolveMotion(settings[SETTING_IDS.motion])).pulseMs;
    const f = Array.isArray(frac) ? frac : [frac?.rx, frac?.ry, frac?.rw, frac?.rh];
    const viewH = () => doc.defaultView?.innerHeight || 0;
    let node = null;
    const place = () => {
      try { img.scrollIntoView?.({ block: "center", behavior: "instant" }); } catch { /* no layout */ }
      const box = img.getBoundingClientRect?.();
      if (!box || !(box.width > 0) || !(box.height > 0)) return false;
      if (ms > 0) {
        if (!node) {
          node = doc.createElement("div");
          node.className = "pxd-item--pulse";
          node.style.position = "fixed";
          node.style.pointerEvents = "none";
          doc.body.append(node);
          const drop = () => node.remove();
          lifecycle.timeout(drop, ms);
          lifecycle.add(drop);
        }
        node.style.left = `${(box.left || 0) + Number(f[0] || 0) * box.width}px`;
        node.style.top = `${(box.top || 0) + Number(f[1] || 0) * box.height}px`;
        node.style.width = `${Number(f[2] || 0) * box.width}px`;
        node.style.height = `${Number(f[3] || 0) * box.height}px`;
      }
      const vh = viewH();
      return box.top >= 0 && box.bottom <= vh + 1;
    };
    const kick = (left) => {
      if (stopped) return;
      place();
      if (left > 0) lifecycle.timeout(() => kick(left - 1), 100);
    };
    kick(10);
  }

  function openOutlineImage(pageUid, drawingUid, frac) {
    if (!pageUid) return;
    const landed = (left) => {
      if (stopped) return;
      const img = outlineImage(drawingUid);
      if (!img) {
        if (left > 0) lifecycle.timeout(() => landed(left - 1), 150);
        return;
      }
      pulseOutline(img, frac);
    };
    if (openPageUid() === pageUid) {
      landed(8);
      return;
    }
    try { host.openPage?.(pageUid); } catch { /* host unavailable */ }
    let tries = 0;
    const wait = () => {
      if (stopped) return;
      if (openPageUid() === pageUid) {
        landed(8);
        return;
      }
      tries += 1;
      if (tries >= 8) return;
      lifecycle.timeout(wait, 150);
    };
    lifecycle.timeout(wait, 150);
  }

  function openImageTarget(region, regionUid, shiftKey) {
    let hit = null;
    try { hit = host.showOnBoard?.(region.drawingUid) || null; } catch { hit = null; }
    let pageUid = "";
    try { pageUid = host.blockPageUid?.(region.drawingUid) || ""; } catch { pageUid = ""; }
    const target = resolveRegionTarget(hit, { blockUid: region.drawingUid, pageUid });
    if (shiftKey) {
      if (target.kind === "board") {
        try { host.openInSidebar?.(target.boardUid, "block"); } catch { /* host unavailable */ }
        applyShowAll();
      }
      return;
    }
    if (target.kind === "board") {
      revealMain(target.boardUid);
      deepLinkTo(target.pageUid, regionUid);
      return;
    }
    openOutlineImage(target.pageUid, region.drawingUid, region.f);
  }

  function openViewTarget(region, regionUid, shiftKey) {
    const boardUid = region.drawingUid;
    if (shiftKey) {
      try { host.openInSidebar?.(boardUid, "block"); } catch { /* host unavailable */ }
      applyShowAll();
      return;
    }
    let pageUid = "";
    try { pageUid = host.blockPageUid?.(boardUid) || ""; } catch { pageUid = ""; }
    revealMain(boardUid);
    if (pageUid) deepLinkTo(pageUid, regionUid);
  }

  function loadViewBoard(region) {
    const id = region?.drawingUid;
    if (!id) return null;
    const hit = viewBoards.get(id);
    if (hit && Date.now() - hit.at < VIEW_BOARD_TTL_MS) return hit.board;
    let session = null;
    let board = null;
    try {
      session = acquireSession(id, { host, settings: liveSettings });
      board = session?.board || null;
    } catch {
      board = null;
    } finally {
      try { session?.release?.(); } catch { /* already released */ }
    }
    viewBoards.set(id, { board, at: Date.now() });
    return board;
  }

  function popButton(parent, text, shiftKey, onOpen) {
    const button = (parent.ownerDocument || doc).createElement("button");
    button.type = "button";
    button.textContent = text;
    button.addEventListener("pointerdown", (event) => event.stopPropagation?.());
    button.addEventListener("click", (event) => {
      event.preventDefault?.();
      event.stopPropagation?.();
      onOpen?.({ shiftKey });
    });
    parent.append(button);
    return button;
  }

  function sizedInline(node, w, h) {
    node.style.setProperty("display", "inline-block", "important");
    node.style.width = `${w}px`;
    node.style.height = `${h}px`;
  }

  function fillImagePopover(el, button, region, onOpen) {
    const popDoc = el.ownerDocument || doc;
    const crop = button?.parentElement?.querySelector?.(".pxd-region-crop");
    const img = crop?.querySelector?.("img");
    const box = previewImageBox(img?.naturalWidth, img?.naturalHeight);
    if (box) {
      const preview = popDoc.createElement("span");
      preview.className = "pxd-region-preview";
      preview.style.position = "relative";
      preview.style.overflow = "hidden";
      sizedInline(preview, box.w, box.h);
      if (img?.src) {
        const pic = popDoc.createElement("img");
        pic.alt = region.caption || "";
        pic.draggable = false;
        pic.src = img.src;
        pic.style.position = "absolute";
        pic.style.left = "0";
        pic.style.top = "0";
        pic.style.width = `${box.w}px`;
        pic.style.height = `${box.h}px`;
        preview.append(pic);
      }
      const hole = holeRect(box, region.f);
      if (hole) {
        const veil = (x, y, w, h) => {
          if (!(w > 0) || !(h > 0)) return;
          const s = popDoc.createElement("span");
          s.className = "pxd-region-veil";
          s.style.position = "absolute";
          s.style.left = `${x}px`;
          s.style.top = `${y}px`;
          s.style.background = "rgba(0,0,0,0.4)";
          s.style.pointerEvents = "none";
          sizedInline(s, w, h);
          preview.append(s);
        };
        veil(0, 0, box.w, hole.y);
        veil(0, hole.y, hole.x, hole.h);
        veil(hole.x + hole.w, hole.y, box.w - hole.x - hole.w, hole.h);
        veil(0, hole.y + hole.h, box.w, box.h - hole.y - hole.h);
        const holeSpan = popDoc.createElement("span");
        holeSpan.className = "pxd-region-hole";
        holeSpan.style.position = "absolute";
        holeSpan.style.left = `${hole.x}px`;
        holeSpan.style.top = `${hole.y}px`;
        holeSpan.style.pointerEvents = "none";
        sizedInline(holeSpan, hole.w, hole.h);
        preview.append(holeSpan);
      }
      el.append(preview);
    }
    const caption = popDoc.createElement("span");
    caption.className = "pxd-region-pop__caption";
    caption.textContent = region.caption || "";
    el.append(caption);
    popButton(el, "Open", false, onOpen);
    popButton(el, "Open in sidebar", true, onOpen);
  }

  function fillViewPopover(el, region, onOpen) {
    const popDoc = el.ownerDocument || doc;
    const board = loadViewBoard(region);
    if (board) {
      const svg = drawViewMap(popDoc, el, viewMapModel(board, region.v, region.ids));
      const w = parseFloat(svg.style.width);
      const h = parseFloat(svg.style.height);
      if (w > 0 && h > 0) {
        svg.style.width = "480px";
        svg.style.height = `${(480 * h) / w}px`;
      }
    }
    if (region.caption) {
      const caption = popDoc.createElement("span");
      caption.textContent = region.caption;
      el.append(caption);
    }
    popButton(el, "Open", false, onOpen);
    popButton(el, "Open in sidebar", true, onOpen);
  }

  function considerRegionButton(button) {
    if (!active() || !button || button.getAttribute?.("data-plexus-owner")) return;
    const uid = regionUidForButton(button, (id) => {
      try { return host.blockString?.(id) || ""; } catch { return ""; }
    });
    if (!uid) return;
    let text = "";
    try { text = host.blockString?.(uid) || ""; } catch { return; }
    const region = parseRegion(text);
    if (!region || region.owner !== "plexus-diagram" || region.supported !== true) return;
    if (region.kind !== "img" && region.kind !== "view") return;
    const delayMs = tooltipDelay(settings[SETTING_IDS.tooltipDelay]);
    const obstacles = () => {
      const root = doc?.querySelector?.(".pxd-root");
      return root ? chromeObstacles(root) : [];
    };
    const onOpen = ({ shiftKey } = {}) => {
      showWhere = shiftKey ? "sidebar" : "main";
      showStash.stash({ uid });
      if (region.kind === "view") openViewTarget(region, uid, Boolean(shiftKey));
      else openImageTarget(region, uid, Boolean(shiftKey));
    };
    const buildPopover = (el) => {
      if (region.kind === "view") fillViewPopover(el, region, onOpen);
      else fillImagePopover(el, button, region, onOpen);
    };
    const handle = region.kind === "view"
      ? openRegionView({
        doc,
        button,
        region,
        onOpen,
        delayMs,
        buildPopover,
        obstacles,
        loadBoard: () => loadViewBoard(region),
      })
      : openRegionCrop({
        doc,
        button,
        region,
        onOpen,
        delayMs,
        buildPopover,
        obstacles,
        loadFile: (parsed) => {
          try {
            const src = imageSrc(host.blockString?.(parsed.drawingUid) || "");
            return src && typeof host.getFile === "function" ? host.getFile(src) : null;
          } catch {
            return null;
          }
        },
      });
    const drop = () => {
      handle.destroy();
      regionCrops.delete(button);
    };
    regionCrops.set(button, drop);
  }

  function scanRegions(node) {
    if (!active()) return;
    eachRegionButton(node, considerRegionButton);
  }

  function scanAdded(node) {
    for (const diagram of diagramsWithin(node)) consider(diagram);
    if (active()) {
      relChips.scan(node);
      boardChips.scan(node);
      cardChips.scan(node);
      resurface.scan(node);
    }
    scanRegions(node);
  }

  function reconcile() {
    if (stopped) return;
    ensureSidebarWatch();
    const windows = sidebarWindows();
    for (const rec of [...mounts.values()]) {
      if (rec.native.isConnected === false || rec.mountEl.isConnected === false) unmount(rec);
      else applyVisibility(rec, windows, false);
    }
    for (const [node, observer] of portalObservers) {
      if (node.isConnected === false) {
        observer.disconnect();
        portalObservers.delete(node);
      }
    }
    for (const native of [...convertButtons.keys()]) {
      if (native.isConnected === false) dropConvert(native);
    }
    // Roam re-renders blocks and takes the button with it. Release the crop so its image URL can go.
    for (const [button, drop] of [...regionCrops]) {
      if (button.isConnected === false) drop();
    }
    if (!active()) {
      for (const rec of [...mounts.values()]) unmount(rec);
      for (const native of [...convertButtons.keys()]) dropConvert(native);
      for (const drop of [...regionCrops.values()]) drop();
      return;
    }
    if (!doc) return;
    for (const diagram of doc.querySelectorAll(".rm-diagram")) consider(diagram);
  }

  function onHash(event) {
    const target = pxdTarget(hashFromUrl(event?.newURL));
    if (target?.cardUid && showStash.peek(target.cardUid)) applyShowAll();
    onNavigate();
  }

  function onNavigate() {
    mountFail.clear();
    // The route changed. A uid classified on the previous page has to be read again.
    negativeUntil.clear();
    autoCache.clear();
    for (const rec of mounts.values()) {
      if (routeLeftZoomedDiagram(rec.uid)) {
        if (rec.fullscreen) setFullscreen(rec, false);
      } else if (settings[SETTING_IDS.fullscreenOnZoom] !== false && !rec.fullscreen) {
        setFullscreen(rec, true);
      }
    }
    reconcile();
  }

  // ---- commands -------------------------------------------------------------------------------

  function focusedUid(context) {
    return context?.["block-uid"]
      || host.api?.ui?.getFocusedBlock?.()?.["block-uid"]
      || extensionAPI?.ui?.getFocusedBlock?.()?.["block-uid"]
      || null;
  }

  function diagramAncestorUid(uid) {
    if (!uid) return null;
    if (isDiagramString(host.blockString?.(uid))) return uid;
    try {
      const rows = host.q?.(PARENTS_QUERY, uid) || [];
      const hits = rows.filter((row) => isDiagramString(row[1])).map((row) => row[0]);
      if (hits.length < 2) return hits[0] ?? null;
      // Nested boards give several diagram ancestors: take the nearest, the one that has all the others above it.
      const deepest = hits.find((cand) => {
        const above = new Set((host.q?.(PARENTS_QUERY, cand) || []).map((row) => row[0]));
        return hits.every((other) => other === cand || above.has(other));
      });
      return deepest ?? hits[0];
    } catch {
      return null;
    }
  }

  function resolveBoardUid(context) {
    const fromFocus = diagramAncestorUid(focusedUid(context));
    if (fromFocus) return fromFocus;
    const zoomed = diagramUidFromLocation();
    if (zoomed && isDiagramString(host.blockString?.(zoomed))) return zoomed;
    const uids = new Set([...mounts.values()].map((rec) => rec.uid));
    return uids.size === 1 ? [...uids][0] : null;
  }

  async function enhanceCommand(context, explicitUid = null) {
    const uid = explicitUid || resolveBoardUid(context);
    if (!uid) {
      console.info("[plexus-diagram] Focus a {{[[diagram]]}} block first");
      return;
    }
    const session = acquireSession(uid, { host, settings: liveSettings });
    try {
      await session.enhance();
    } finally {
      session.release();
    }
    markEnhanced(uid);
    reconcile();
  }

  async function restoreCommand(context) {
    const uid = resolveBoardUid(context);
    if (!uid) return;
    const session = acquireSession(uid, { host, settings: liveSettings });
    try {
      await session.restoreNative();
    } finally {
      session.release();
    }
    markNative(uid);
    for (const rec of [...mounts.values()]) if (rec.uid === uid) unmount(rec);
  }

  async function newWhiteboardCommand(context) {
    const parentUid = focusedUid(context);
    if (!parentUid) {
      console.info("[plexus-diagram] Focus a block first; the whiteboard is created under it");
      return;
    }
    const uid = host.generateUid();
    await host.createBlock({
      parentUid,
      order: "last",
      uid,
      string: NEW_BOARD_STRING,
      props: { plexus: { v: 2 } },
      open: settings[SETTING_IDS.collapseOutline] === false ? undefined : false,
    });
    markEnhanced(uid);
    await host.openBlock(uid);
  }

  function fullscreenCommand(context) {
    const uid = resolveBoardUid(context);
    const recs = [...mounts.values()].filter((rec) => !uid || rec.uid === uid);
    const rec = recs.find((r) => r.native.isConnected !== false) || recs[0];
    if (rec) setFullscreen(rec, !rec.fullscreen);
  }

  function targetView(context) {
    const uid = resolveBoardUid(context);
    const recs = [...mounts.values()].filter((rec) => !uid || rec.uid === uid);
    const rec = recs.find((r) => r.native.isConnected !== false) || recs[0];
    return rec?.view ?? null;
  }

  function exportSvgCommand(context) {
    return targetView(context)?.exportSvg?.({ download: true });
  }

  function copyOutlineCommand(context) {
    return targetView(context)?.copyOutline?.();
  }

  function addPageCommand(context) {
    return targetView(context)?.addPage?.();
  }

  function newDrawingCommand(context) {
    return targetView(context)?.newDrawing?.();
  }

  async function resurfaceCommand(context) {
    const parentUid = focusedUid(context);
    if (!parentUid) {
      console.info("[plexus-diagram] Focus a block first");
      return;
    }
    await host.createBlock({ parentUid, order: "last", string: "{{[[plexus-resurface]]}}" });
  }

  const sheetActions = [
    ["Plexus: Enhance this diagram", enhanceCommand],
    ["Plexus: New whiteboard here", newWhiteboardCommand],
    ["Plexus: Restore native diagram", restoreCommand],
    ["Plexus: Fullscreen this diagram", fullscreenCommand],
    ["Plexus: Export board as SVG", exportSvgCommand],
    ["Plexus: Copy board as text", copyOutlineCommand],
  ];
  // Sheet only: no slash command and no palette entry (PF-1).
  const sheetOnlyActions = [
    ["Plexus: Add page…", addPageCommand],
    ["Plexus: New drawing here", newDrawingCommand],
    ["Plexus: Resurface here", resurfaceCommand],
  ];

  function runCommand(label, fn) {
    return (context) => {
      if (!active()) {
        console.info("[plexus-diagram] Command skipped: extension disabled");
        return;
      }
      Promise.resolve(fn(context)).catch((error) => console.warn(`[plexus-diagram] ${label} failed`, error));
    };
  }

  // Roam's palette blurs the block as soon as a command runs, so the uid is captured first.
  function openCommandSheet(capturedUid) {
    closeCommandSheet();
    const sheet = doc.createElement("div");
    sheet.className = "pxd-commands";
    const back = doc.createElement("button");
    back.type = "button";
    back.className = "pxd-commands-back";
    back.setAttribute("aria-label", "Close commands");
    const box = doc.createElement("div");
    box.className = "pxd-commands__box";
    box.setAttribute("role", "menu");
    const title = doc.createElement("div");
    title.className = "pxd-commands__title";
    title.textContent = "Plexus";
    box.append(title);
    for (const [label, fn] of [...sheetActions, ...sheetOnlyActions]) {
      const row = doc.createElement("button");
      row.type = "button";
      row.className = "pxd-commands__row";
      row.textContent = label.replace(/^Plexus: /, "");
      row.setAttribute("aria-label", row.textContent);
      row.onclick = () => {
        closeCommandSheet();
        if (!active()) return;
        const context = capturedUid ? { "block-uid": capturedUid } : {};
        Promise.resolve(fn(context)).catch((error) => console.warn(`[plexus-diagram] ${label} failed`, error));
      };
      box.append(row);
    }
    sheet.append(back);
    sheet.append(box);
    lifecycle.node(sheet, doc.body);
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault?.();
      closeCommandSheet();
    };
    if (typeof doc.addEventListener === "function") doc.addEventListener("keydown", onKey);
    back.onclick = (event) => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      closeCommandSheet();
    };
    let closed = false;
    closeCommandSheet = () => {
      if (closed) return;
      closed = true;
      if (typeof doc.removeEventListener === "function") doc.removeEventListener("keydown", onKey);
      sheet.remove();
      closeCommandSheet = () => {};
    };
  }

  async function registerCommands() {
    await lifecycle.command(extensionAPI.ui.commandPalette, {
      label: "Plexus: Commands…",
      callback: (context) => {
        if (!active()) {
          console.info("[plexus-diagram] Command skipped: extension disabled");
          return;
        }
        openCommandSheet(focusedUid(context));
      },
    });
    await lifecycle.command(extensionAPI.ui.commandPalette, {
      label: "Plexus: New whiteboard here",
      callback: runCommand("Plexus: New whiteboard here", newWhiteboardCommand),
    });
    if (extensionAPI.ui?.slashCommand?.addCommand) {
      for (const [label, fn] of sheetActions) {
        await lifecycle.command(extensionAPI.ui.slashCommand, { label, callback: runCommand(label, fn) });
      }
    }
    if (extensionAPI.ui?.blockContextMenu?.addCommand) {
      await lifecycle.command(extensionAPI.ui.blockContextMenu, {
        label: "Plexus: Enhance",
        "display-conditional": (event) => isDiagramString(event?.["block-string"]),
        callback: (event) => {
          if (!active()) return;
          enhanceCommand(event).catch((error) => console.warn("[plexus-diagram] Enhance failed", error));
        },
      });
      await lifecycle.command(extensionAPI.ui.blockContextMenu, {
        label: "Show on board",
        "display-conditional": (event) => {
          if (!active()) return false;
          const uid = event?.["block-uid"];
          if (!uid || typeof host.showOnBoard !== "function") return false;
          try {
            const hit = host.showOnBoard(uid);
            return Boolean(hit?.boardUid && hit?.cardUid && hit?.pageUid);
          } catch {
            return false;
          }
        },
        callback: (event) => {
          if (!active()) return;
          const uid = event?.["block-uid"];
          let hit = null;
          try { hit = uid ? host.showOnBoard?.(uid) : null; } catch { hit = null; }
          if (!hit?.pageUid || !hit?.cardUid) return;
          assignDeepLink(globalThis.location, {
            graph: host.graph || graphFromHash(),
            pageUid: hit.pageUid,
            cardUid: hit.cardUid,
          }, () => {
            try { win.dispatchEvent?.(new Event("hashchange")); } catch { /* already on this card */ }
          });
        },
      });
      await lifecycle.command(extensionAPI.ui.blockContextMenu, {
        label: "Add to board…",
        "display-conditional": (event) => active() && Boolean(event?.["block-uid"]),
        callback: (event) => {
          if (!active()) return;
          const blockUid = event?.["block-uid"];
          if (!blockUid) return;
          closeAddToBoard();
          const picker = openAddToBoard({
            doc,
            blockUid,
            listBoards: () => host.listBoards?.() ?? [],
            onPick: async (board) => {
              if (!board?.uid || board.uid === blockUid) return false;
              let session = null;
              try {
                session = acquireSession(board.uid, { host, settings: liveSettings });
                const id = await session?.addBlockRef?.(blockUid);
                return Boolean(id);
              } catch (error) {
                console.warn("[plexus-diagram] Add to board failed", error);
                return false;
              } finally {
                session?.release?.();
              }
            },
          });
          closeAddToBoard = () => { picker.close(); closeAddToBoard = () => {}; };
        },
      });
      await lifecycle.command(extensionAPI.ui.blockContextMenu, {
        label: "Plexus: Mark image region",
        "display-conditional": (event) => active() && classifyString(event?.["block-string"]).kind === "image",
        callback: (event) => {
          if (!active()) return;
          if (classifyString(event?.["block-string"]).kind !== "image") {
            say(OUTLINE_TOAST.notImage);
            return;
          }
          const blockUid = event?.["block-uid"];
          const img = outlineImage(blockUid);
          if (!img) {
            say(OUTLINE_TOAST.ready);
            return;
          }
          outlineMark?.destroy?.();
          outlineMark = mountOutlineRegion({
            doc,
            img,
            onConfirm: async ({ frac, caption }) => {
              outlineMark = null;
              const uid = host.generateUid?.();
              if (!uid) return;
              let session = null;
              let made = false;
              try {
                session = acquireSession(blockUid, { host, settings: liveSettings });
                // The ref is copied and the toast shown only once the write has a result.
                const result = await session?.addImageRegion?.(blockUid, frac, caption, uid);
                made = result !== null && result !== false;
              } catch (error) {
                console.warn("[plexus-diagram] Mark image region failed", error);
              } finally {
                try { session?.release?.(); } catch { /* already released */ }
              }
              if (stopped) return;
              if (!made) {
                say(OUTLINE_TOAST.failed);
                return;
              }
              try {
                const pending = globalThis.navigator?.clipboard?.writeText?.(`((${uid}))`);
                if (pending && typeof pending.catch === "function") pending.catch(() => {});
              } catch { /* the region is written; the ref can be copied from the block */ }
              say(OUTLINE_TOAST.copied);
            },
            onCancel: () => { outlineMark = null; },
          });
        },
      });
      lifecycle.add(() => closeAddToBoard());
    }
    lifecycle.add(() => closeCommandSheet());
  }

  // ---- settings -------------------------------------------------------------------------------

  function syncSpeedLog() {
    if (stopped || settings[SETTING_IDS.speedLog] !== true) {
      perfLog.stop();
      shiftWatch.stop();
    } else {
      perfLog.start({ stats: host.stats, lifecycle });
      shiftWatch.start({ stats: host.stats, lifecycle, enabled: true });
    }
  }

  lifecycle.add(onSettingsChange((id, value) => {
    if (stopped) return;
    const next = id === SETTING_IDS.speedFlags ? parseSpeedFlags(value) : normalizeSetting(id, value);
    settings = { ...settings, [id]: next };
    if (id === SETTING_IDS.speedFlags) noteSpeedFlags(next);
    if (id === SETTING_IDS.speedLog) syncSpeedLog();
    if (id === SETTING_IDS.autoEnhance) {
      autoCache.clear();
      negativeUntil.clear();
      if (settings[id] === false) {
        // Boards that are only virtual give the native diagram back. Stamped boards stay boards.
        for (const rec of [...mounts.values()]) {
          const virtual = rec.session ? rec.session.board?.virtual === true : rec.virtual && virtualUids.has(rec.uid);
          if (virtual) unmount(rec);
        }
        for (const uid of [...virtualUids]) {
          virtualUids.delete(uid);
          if (!trusted.has(uid) && !legacyUids.has(uid)) guardUids.delete(uid);
        }
      }
    }
    syncGuard();
    if (!active()) {
      for (const rec of [...mounts.values()]) unmount(rec);
      return;
    }
    for (const rec of [...mounts.values()]) {
      try {
        if (typeof rec.view?.setSettings === "function") {
          rec.view.setSettings(settings);
        } else if (!rec.dormant) {
          const { native, crumbs } = rec;
          unmount(rec);
          consider(native, { crumbs });
        }
      } catch (error) {
        console.warn("[plexus-diagram] Settings propagation failed", error);
      }
    }
    reconcile();
    cardChips.scan(doc?.body);
  }));

  // ---- install --------------------------------------------------------------------------------

  function borderStroke() {
    const probe = doc?.querySelector?.(".pxd-root") || doc?.body || doc?.documentElement;
    let color = "";
    try {
      const view = doc?.defaultView || win;
      const style = probe ? view?.getComputedStyle?.(probe) : null;
      color = style?.getPropertyValue?.("--pxd-border") || style?.borderTopColor || "";
    } catch { color = ""; }
    return thumbStroke(color);
  }

  function rasterBoard(svg, width, height) {
    return new Promise((resolve) => {
      const view = doc?.defaultView || win;
      let url = "";
      const finish = (blob) => {
        try { if (url) URL.revokeObjectURL(url); } catch { /* already revoked */ }
        resolve(blob || null);
      };
      try {
        const xml = new view.XMLSerializer().serializeToString(svg);
        url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml" }));
      } catch {
        finish(null);
        return;
      }
      const Img = view.Image;
      if (typeof Img !== "function") { finish(null); return; }
      const img = new Img();
      img.onload = () => {
        const w = Math.max(1, Math.round(width));
        const h = Math.max(1, Math.round(height));
        const Off = view.OffscreenCanvas;
        if (typeof Off === "function") {
          try {
            const canvas = new Off(w, h);
            const g = canvas.getContext("2d");
            g.drawImage(img, 0, 0, w, h);
            Promise.resolve(canvas.convertToBlob({ type: "image/png" })).then(finish, () => finish(null));
            return;
          } catch { /* hidden canvas below */ }
        }
        const canvas = doc.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.hidden = true;
        try { canvas.style.position = "fixed"; canvas.style.left = "-10000px"; } catch { /* stub */ }
        try { (doc.body || doc.documentElement).append(canvas); } catch { /* stub */ }
        try {
          const g = canvas.getContext("2d");
          g.drawImage(img, 0, 0, w, h);
          if (typeof canvas.toBlob !== "function") { canvas.remove?.(); finish(null); return; }
          canvas.toBlob((blob) => { canvas.remove?.(); finish(blob); }, "image/png");
        } catch {
          canvas.remove?.();
          finish(null);
        }
      };
      img.onerror = () => finish(null);
      img.src = url;
    });
  }

  function thumbnailBoard(boardUid, opts = {}) {
    const maxWidth = Number.isFinite(opts?.maxWidth) && opts.maxWidth > 0 ? opts.maxWidth : 160;
    let pulled = null;
    try { pulled = host.pullBoard?.(boardUid); } catch { pulled = null; }
    const board = pulled ? buildBoard(pulled) : null;
    if (!board || !doc) return Promise.resolve(null);
    const rects = worldRects(board);
    const cards = [];
    for (const item of board.items.values()) {
      if (item.type === "section") continue;
      const rect = rects.get(item.uid);
      if (rect) cards.push(rect);
    }
    const bounds = boardBounds(cards.length ? cards : [...rects.values()]);
    const fit = fitThumbSize(bounds.w, bounds.h, maxWidth);
    if (!fit) return Promise.resolve(null);
    const svg = minimapSvg(doc, { v: bounds, items: cards, size: fit.width });
    svg.setAttribute("width", String(fit.width));
    svg.setAttribute("height", String(fit.height));
    const stroke = borderStroke();
    for (const node of svg.querySelectorAll?.("[stroke]") || []) node.setAttribute("stroke", stroke);
    return rasterBoard(svg, fit.width, fit.height);
  }

  function mountSize(rec) {
    const root = rec?.view?.root || rec?.mountEl;
    const box = root?.getBoundingClientRect?.() || {};
    return {
      width: Number(box.width) || Number(rec?.mountEl?.clientWidth) || 0,
      height: Number(box.height) || Number(rec?.mountEl?.clientHeight) || 0,
    };
  }

  function findOpenMount(boardUid, sidebar) {
    for (const rec of mounts.values()) {
      if (!rec?.view || rec.dormant) continue;
      if (rec.uid !== boardUid && currentUid(rec) !== boardUid) continue;
      if (sidebar ? isSidebarMount(rec) : !isSidebarMount(rec)) return rec;
    }
    return null;
  }

  function waitOpenMount(boardUid, sidebar, left, done) {
    const rec = findOpenMount(boardUid, sidebar);
    if (rec || left <= 0) { done(rec); return; }
    lifecycle.timeout(() => waitOpenMount(boardUid, sidebar, left - 1, done), 50);
  }

  function showCard(rec, cardUid) {
    try { rec.view?.focusUid?.(cardUid); } catch { /* view gone */ }
  }

  function showSavedView(rec, viewUid, left) {
    let text = "";
    try { text = host.blockString?.(viewUid) || ""; } catch { text = ""; }
    const region = parseRegion(text);
    if (!region || region.kind !== "view" || region.supported !== true) return;
    const cam = setCameraFromView(region.v, mountSize(rec));
    if (!cam) {
      if (left > 0) lifecycle.timeout(() => showSavedView(rec, viewUid, left - 1), 50);
      return;
    }
    try { rec.view?.applyShow?.({ kind: "view", v: region.v, ids: region.ids || [] }); } catch { /* view gone */ }
  }

  function aimMount(rec, opts) {
    if (!rec?.view) return;
    const viewUid = typeof opts?.view === "string" ? opts.view : (typeof opts?.region === "string" ? opts.region : "");
    if (viewUid) showSavedView(rec, viewUid, 20);
    if (opts?.card) showCard(rec, opts.card);
  }

  function openPublic(boardUid, opts = {}) {
    const sidebar = Boolean(opts?.sidebar);
    if (sidebar) {
      try { void host.openInSidebar?.(boardUid, "block"); } catch { /* host unavailable */ }
    } else if (!findOpenMount(boardUid, false)) {
      const asleep = [...mounts.values()].find((rec) => !isSidebarMount(rec) && (rec.uid === boardUid || currentUid(rec) === boardUid));
      if (asleep?.mountEl) {
        try { asleep.mountEl.scrollIntoView?.({ block: "center" }); } catch { /* no layout */ }
      } else {
        let pageUid = "";
        try { pageUid = host.blockPageUid?.(boardUid) || ""; } catch { pageUid = ""; }
        try {
          if (pageUid) void host.openPage?.(pageUid);
          else void host.openBlock?.(boardUid);
        } catch { /* host unavailable */ }
      }
    }
    return new Promise((resolve) => {
      waitOpenMount(boardUid, sidebar, 40, (rec) => {
        if (!rec) { resolve(false); return; }
        aimMount(rec, opts);
        resolve(true);
      });
    });
  }

  const publicApi = createPublicApi({
    host: {
      graphName: () => host.graph || graphFromHash(),
      listBoards: (...args) => host.listBoards?.(...args),
      q: (...args) => host.q?.(...args),
      pullBoard: (uid) => host.pullBoard?.(uid),
    },
    version: badge,
    addCard: (boardUid, string, x, y) => {
      const session = acquireSession(boardUid, { host, settings: liveSettings });
      return Promise.resolve(session?.addPublicCard?.({ string, x, y })).finally(() => {
        try { session?.release?.(); } catch { /* already released */ }
      });
    },
    openBoard: (boardUid, opts) => openPublic(boardUid, opts),
    thumbnail: (boardUid, opts) => thumbnailBoard(boardUid, opts),
  });
  publicEmit = (type, detail) => emitPublicEvent(publicApi, type, detail);
  installPublicApi(publicApi, { win });

  const api = {
    version: badge,
    stats: host.stats,
    mounts: () => [...mounts.values()].map((rec) => ({
      uid: rec.uid,
      current: currentUid(rec),
      crumbs: rec.crumbs.map((c) => c.uid),
      fullscreen: rec.fullscreen,
      connected: rec.native.isConnected !== false && rec.mountEl.isConnected !== false,
      state: rec.view?.state?.() ?? null,
    })),
    // "Open on board" for a connection (RF-3).
    openConnection: (boardUid, edgeUid) => openNestedConnection(boardUid, edgeUid),
    cardCacheMs: () => cacheLoadMs,
    cameraRect(boardUid) {
      const rec = pickCameraMount([...mounts.values()], boardUid, isSidebarMount, currentUid);
      try { return rec?.view?.cameraRect?.() ?? null; } catch { return null; }
    },
    // Caller must release(). A second acquire of the same board shares the session.
    session(uid) {
      if (!uid) return null;
      return acquireSession(uid, { host, settings: liveSettings });
    },
  };
  win.__plexusDiagram = api;
  lifecycle.add(() => {
    uninstallPublicApi(publicApi, { win });
    if (win.__plexusDiagram === api) delete win.__plexusDiagram;
  });

  syncGuard();
  await registerCommands();
  // Read the connection-block uids once the page has settled, off the install path.
  lifecycle.timeout(() => {
    if (stopped || !active()) return;
    relChips.start();
    refreshCardCache();
    resurface.scan(doc.body);
  }, 600);
  lifecycle.interval(() => {
    if (stopped || !active()) return;
    refreshCardCache();
  }, 60000);

  if (doc && typeof globalThis.MutationObserver === "function") {
    const onAdded = (records) => {
      for (const record of records) {
        for (const node of record.addedNodes || []) {
          if (node.nodeType === 1) scanAdded(node);
        }
      }
    };
    const app = doc.querySelector(".roam-app");
    if (app) lifecycle.observer(new MutationObserver(onAdded), app, { childList: true, subtree: true });
    if (doc.body) {
      // Blueprint portals (popovers, sidebar previews) are siblings of .roam-app.
      lifecycle.observer(new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes || []) {
            if (node.nodeType !== 1 || !node.classList?.contains("bp3-portal") || portalObservers.has(node)) continue;
            const observer = new MutationObserver(onAdded);
            observer.observe(node, { childList: true, subtree: true });
            portalObservers.set(node, observer);
            scanAdded(node);
          }
        }
      }), doc.body, { childList: true });
    }
  }
  scanRegions(doc);
  for (const portal of doc?.querySelectorAll?.(".bp3-portal") || []) scanRegions(portal);
  // Typing outside a board is a Roam transaction. The board view drops live Roam
  // roots on its window keydown (quiet). An on-screen board stays mounted; this
  // only asks a mount that exposes quiet. Off-screen boards are parked by the
  // viewport observer, not by the key.
  let wakeTimer = null;
  let quietTimer = null;
  const wakeVisible = () => {
    wakeTimer = null;
    const height = win.innerHeight || 0;
    const windows = sidebarWindows();
    for (const rec of mounts.values()) {
      if (!rec.dormant) continue;
      if (hostHides(rec, windows)) continue;
      const box = rec.mountEl.getBoundingClientRect?.();
      if (!box) continue;
      if (box.bottom > -60 && box.top < height + 60) wake(rec);
    }
  };
  const armWake = () => {
    if (wakeTimer) clearTimeout(wakeTimer);
    wakeTimer = setTimeout(wakeVisible, 700);
  };
  const endQuiet = () => {
    quietTimer = null;
    for (const rec of mounts.values()) {
      try { rec.view?.quiet?.(false); } catch { /* view gone */ }
    }
  };
  const armQuiet = () => {
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = setTimeout(endQuiet, 700);
  };
  const quietOutside = (target) => {
    if (!isTextEntryTarget(target)) return;
    let asked = false;
    for (const rec of mounts.values()) {
      if (!rec?.view || rec.dormant) continue;
      if (rec.mountEl?.contains?.(target) || rec.view.root?.contains?.(target)) continue;
      if (typeof rec.view.quiet !== "function") continue;
      try {
        rec.view.quiet(true);
        asked = true;
      } catch { /* view gone */ }
    }
    if (asked) armQuiet();
  };
  if (doc && typeof doc.addEventListener === "function") {
    // `input` covers the burst. A document keydown would sit beside the command sheet's own Escape listener.
    lifecycle.event(doc, "input", (event) => quietOutside(event.target), true);
  }
  const parkMainForSidebar = () => {
    for (const rec of mounts.values()) {
      if (inRightSidebar(rec.native) || inRightSidebar(rec.mountEl)) continue;
      hibernate(rec, { force: true });
    }
    armWake();
  };
  function ensureSidebarWatch() {
    if (sidebarWatch || typeof MutationObserver !== "function") return;
    const article = doc.querySelector?.(".rm-article-wrapper");
    if (!article) return;
    let open = article.classList?.contains?.("rm-spacing--right-sidebar-open");
    sidebarWatch = new MutationObserver(() => {
      const next = article.classList?.contains?.("rm-spacing--right-sidebar-open");
      if (next && !open) parkMainForSidebar();
      open = next;
    });
    sidebarWatch.observe(article, { attributes: true, attributeFilter: ["class"] });
  }
  ensureSidebarWatch();
  lifecycle.add(() => { sidebarWatch?.disconnect(); sidebarWatch = null; });
  lifecycle.add(() => {
    if (wakeTimer) clearTimeout(wakeTimer);
    if (quietTimer) clearTimeout(quietTimer);
  });
  if (typeof win.addEventListener === "function") {
    lifecycle.event(win, "hashchange", onHash);
    lifecycle.event(win, "popstate", onNavigate);
  }
  lifecycle.interval(reconcile, RECONCILE_INTERVAL_MS);
  lifecycle.add(() => {
    for (const rec of mounts.values()) forgetSketch(rec);
    sketchStore.dispose();
  });
  // Registered last so it runs first on dispose: nothing may mount while teardown is in flight.
  lifecycle.add(() => { stopped = true; viewportWatch?.disconnect(); });
  syncSpeedLog();
  reconcile();
}

export { enhancedUidGuardCss, findDiagramUidFromEl, isDiagramString, readEnhancedUidCache, writeEnhancedUidCache };
