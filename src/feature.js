import pkg from "../package.json" with { type: "json" };
import { createHost } from "./host/roam.js";
import { acquireSession as acquireSessionDefault } from "./session.js";
import { mountBoardView } from "./view/board-view.js";
import { isTextEntryTarget } from "./view/cards.js";
import { assignDeepLink } from "./model/deeplink.js";
import { openAddToBoard } from "./view/board-picker.js";
import { parseBoardTitle, readPlexus, UNTITLED_BOARD } from "./model/schema.js";
import {
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
  writeEnhancedUidCache,
} from "./discovery.js";
import { normalizeSetting, onSettingsChange, readSettings, SETTING_IDS } from "./settings.js";

// Roam reports `extension.version` as "DEV" for URL / local developer installs,
// so the toolbar badge is stamped from package.json first.
export const PACKAGE_VERSION = pkg.version;

export const RECONCILE_INTERVAL_MS = 400;
const NEGATIVE_TTL_MS = 1500;
const LEGACY_METADATA_PAGE = "plexus-diagram/metadata";
const TITLE_PANEL_CLASS = "rm-diagram-title-panel";
const NEW_BOARD_STRING = "{{[[diagram]]:Untitled board}}";
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

  if (!injectedHost) injectedHost = createHost();
  if (!injectedAcquire) injectedAcquire = acquireSessionDefault;
  if (!mountView) mountView = mountBoardView;
  const host = injectedHost;
  const acquireSession = injectedAcquire;

  let settings = readSettings(extensionAPI);
  // Sessions outlive a settings change (they are ref-counted and kept), so they read through this accessor.
  const liveSettings = { get: (id) => settings[id] };
  let stopped = false;
  let closeAddToBoard = () => {};
  let closeCommandSheet = () => {};
  const mounts = new Map(); // native element -> record
  const trusted = new Set(); // uids confirmed enhanced by this runtime (command results)
  const portalObservers = new Map(); // portal node -> its own added-nodes observer
  const negativeUntil = new Map(); // uid -> timestamp before which a failed pull is not repeated
  const legacyUids = readLegacyEnhanced(host);
  const guardUids = new Set([...readEnhancedUidCache(storage), ...legacyUids]);
  let guardStyle = null;

  const active = () => !stopped && settings[SETTING_IDS.enabled] !== false
    && !(settings[SETTING_IDS.disableOnMobile] && isMobile(extensionAPI));

  // Runs last on dispose (disposers unwind in reverse): tear every mount down, restore native Roam.
  lifecycle.add(() => {
    for (const rec of [...mounts.values()]) unmount(rec);
    for (const observer of portalObservers.values()) observer.disconnect();
    portalObservers.clear();
    // Outline copies skipped by consider() carry a mark that no mount owns; clear it so unload leaves nothing.
    for (const el of [...(doc?.querySelectorAll?.(`.${OUTLINE_NATIVE_CLASS}`) || [])]) el.classList.remove(OUTLINE_NATIVE_CLASS);
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
    syncGuard();
  }

  function markNative(uid) {
    trusted.delete(uid);
    legacyUids.delete(uid);
    guardUids.delete(uid);
    syncGuard();
  }

  function isBoardEnhanced(uid) {
    if (trusted.has(uid) || legacyUids.has(uid)) return true;
    const until = negativeUntil.get(uid);
    if (until && until > Date.now()) return false;
    if (readEnhanced(host.api, uid)) {
      trusted.add(uid);
      if (!guardUids.has(uid)) {
        guardUids.add(uid);
        syncGuard();
      }
      return true;
    }
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

  function mountRecView(rec, { autofocus = false, viewport = null } = {}) {
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
    });
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
      if (currentUid(rec) !== rec.uid) popSilent(rec);
      else unmount(rec);
    });
    const offChange = session.on?.("change", () => {
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

  // In-place navigation between nested boards: same mount element, native surface and fullscreen state,
  // only the view and session are swapped. Deferred so the old view's handler stack unwinds first.
  // `commit` records history only once the target session is in hand.
  function navigate(rec, next, viewport, commit) {
    queueMicrotask(() => {
      if (stopped || mounts.get(rec.native) !== rec || !next.length) return;
      const target = next[next.length - 1].uid;
      if (target === currentUid(rec)) return;
      if (!readEnhanced(host.api, target)) {
        // Never enhance a native diagram from here; Roam opens it.
        try { Promise.resolve(host.openBlock?.(target)).catch(() => {}); } catch { /* host unavailable */ }
        return;
      }
      let session;
      try {
        session = acquireSession(target, { host, settings: liveSettings });
      } catch (error) {
        console.warn("[plexus-diagram] Could not open the nested board", error);
        return;
      }
      if (!session?.board) {
        session?.release?.();
        return;
      }
      try { commit?.(); } catch { /* history is optional */ }
      try { rec.off?.(); } catch { /* ignore */ }
      rec.off = null;
      try { rec.view?.dispose?.(); } catch (error) { console.warn("[plexus-diagram] view dispose failed", error); }
      try { rec.session?.release?.(); } catch (error) { console.warn("[plexus-diagram] session release failed", error); }
      rec.session = session;
      rec.crumbs = next;
      try {
        rec.view = mountRecView(rec, { autofocus: true, viewport: viewport || null });
        rec.off = watchRec(rec);
      } catch (error) {
        console.error("[plexus-diagram] Nested mount failed; native diagram restored", error);
        negativeUntil.set(rec.uid, Date.now() + 10 * NEGATIVE_TTL_MS);
        unmount(rec);
      }
    });
  }

  function mount(uid, native, { crumbs } = {}) {
    const mountEl = doc.createElement("div");
    mountEl.className = "pxd-mount";
    mountEl.dataset.diagramUid = uid;
    const titlePanel = titlePanelOf(native);
    native.classList.remove(OUTLINE_NATIVE_CLASS);
    titlePanel?.classList.remove(OUTLINE_NATIVE_CLASS);
    const rec = {
      uid,
      native,
      mountEl,
      titlePanel,
      titleDisplay: titlePanel ? titlePanel.style.display : "",
      session: null,
      view: null,
      crumbs: crumbs ?? seedCrumbs(uid),
      back: [],
      forward: [],
      fullscreen: false,
      off: null,
    };
    native.classList.add(NATIVE_HIDDEN_CLASS);
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
      return rec;
    }
    try {
      rec.session = acquireSession(currentUid(rec), { host, settings: liveSettings });
      rec.fullscreen = settings[SETTING_IDS.fullscreenOnZoom] !== false
        && !routeLeftZoomedDiagram(uid);
      rec.view = mountRecView(rec);
      rec.off = watchRec(rec);
    } catch (error) {
      console.error("[plexus-diagram] Mount failed; native diagram restored", error);
      negativeUntil.set(uid, Date.now() + 10 * NEGATIVE_TTL_MS);
      unmount(rec);
      return null;
    }
    unmountOutlineCopies(rec);
    // An embed must not collapse the board. The original mount still does, once.
    if (!embedOwnerUid(native, (id) => host.blockString?.(id))) collapseOnce(uid, native);
    if (currentUid(rec) === uid) migrateLegacy(rec);
    ensureViewportWatch();
    recByMount.set(mountEl, rec);
    viewportWatch?.observe(mountEl);
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
  // that walks that DOM. Park the board as a sized gap and bring it back when it nears the viewport.
  const recByMount = new WeakMap();
  let viewportWatch = null;
  let sidebarWatch = null;
  function ensureViewportWatch() {
    if (viewportWatch || typeof IntersectionObserver !== "function") return;
    viewportWatch = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const rec = recByMount.get(entry.target);
        if (!rec || !mounts.has(rec.native)) continue;
        if (entry.isIntersecting) wake(rec);
        else hibernate(rec);
      }
    }, { rootMargin: "60px" });
  }
  function hibernate(rec, { force = false } = {}) {
    if (!rec || rec.dormant || rec.fullscreen || !rec.view) return;
    if (doc.activeElement && rec.mountEl.contains?.(doc.activeElement)) return;
    const height = rec.mountEl.getBoundingClientRect?.().height || 0;
    if (height < 40 && !force) return;
    rec.mountEl.style.minHeight = `${Math.max(40, Math.round(height))}px`;
    try { rec.off?.(); } catch { /* ignore */ }
    rec.off = null;
    try { rec.view.dispose(); } catch (error) { console.warn("[plexus-diagram] hibernate failed", error); }
    try { rec.session?.release?.(); } catch (error) { console.warn("[plexus-diagram] session release failed", error); }
    rec.view = null;
    rec.session = null;
    rec.dormant = true;
  }
  function wake(rec) {
    if (!rec || !rec.dormant || stopped || rec.mountEl.isConnected === false) return;
    rec.dormant = false;
    rec.mountEl.style.minHeight = "";
    try {
      rec.session = acquireSession(currentUid(rec), { host, settings: liveSettings });
      if (!rec.session?.board) {
        rec.session?.release?.();
        unmount(rec);
        return;
      }
      rec.view = mountRecView(rec);
      rec.off = watchRec(rec);
      if (!embedOwnerUid(rec.native, (id) => host.blockString?.(id))) collapseOnce(currentUid(rec), rec.native);
      if (currentUid(rec) === rec.uid) migrateLegacy(rec);
    } catch (error) {
      console.error("[plexus-diagram] Wake failed; native diagram restored", error);
      unmount(rec);
    }
  }

  function unmount(rec) {
    if (!rec || !mounts.has(rec.native)) return;
    viewportWatch?.unobserve(rec.mountEl);
    recByMount.delete(rec.mountEl);
    mounts.delete(rec.native);
    try { rec.off?.(); } catch { /* ignore */ }
    try { rec.view?.dispose?.(); } catch (error) { console.warn("[plexus-diagram] view dispose failed", error); }
    try { rec.session?.release?.(); } catch (error) { console.warn("[plexus-diagram] session release failed", error); }
    rec.mountEl.remove();
    rec.native.classList.remove(NATIVE_HIDDEN_CLASS);
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

  function consider(native, options) {
    if (stopped || !native || mounts.has(native) || native.isConnected === false) return;
    if (!active()) return;
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
    if (!uid || !isBoardEnhanced(uid)) return;
    if (insideEnhancedOutline(native)) {
      // An outline copy stays native; exempt it from the pre-paint guard so its bullet is not blank.
      native.classList.add(OUTLINE_NATIVE_CLASS);
      titlePanelOf(native)?.classList.add(OUTLINE_NATIVE_CLASS);
      return;
    }
    // One plexus root per embed. A second .rm-diagram in that same copy stays native-hidden.
    const scope = embedScope(native, readString);
    if (scope) {
      for (const rec of mounts.values()) {
        if (embedScope(rec.native, readString) === scope) {
          native.classList.add(NATIVE_HIDDEN_CLASS);
          return;
        }
      }
    }
    mount(uid, native, options);
  }

  function scanAdded(node) {
    for (const diagram of diagramsWithin(node)) consider(diagram);
  }

  function reconcile() {
    if (stopped) return;
    ensureSidebarWatch();
    for (const rec of [...mounts.values()]) {
      if (rec.native.isConnected === false || rec.mountEl.isConnected === false) unmount(rec);
    }
    for (const [node, observer] of portalObservers) {
      if (node.isConnected === false) {
        observer.disconnect();
        portalObservers.delete(node);
      }
    }
    if (!active()) {
      for (const rec of [...mounts.values()]) unmount(rec);
      return;
    }
    if (!doc) return;
    for (const diagram of doc.querySelectorAll(".rm-diagram")) consider(diagram);
  }

  function onNavigate() {
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

  async function enhanceCommand(context) {
    const uid = resolveBoardUid(context);
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
      lifecycle.add(() => closeAddToBoard());
    }
    lifecycle.add(() => closeCommandSheet());
  }

  // ---- settings -------------------------------------------------------------------------------

  lifecycle.add(onSettingsChange((id, value) => {
    if (stopped) return;
    settings = { ...settings, [id]: normalizeSetting(id, value) };
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
  }));

  // ---- install --------------------------------------------------------------------------------

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
    // Caller must release(). A second acquire of the same board shares the session.
    session(uid) {
      if (!uid) return null;
      return acquireSession(uid, { host, settings: liveSettings });
    },
  };
  win.__plexusDiagram = api;
  lifecycle.add(() => {
    if (win.__plexusDiagram === api) delete win.__plexusDiagram;
  });

  syncGuard();
  await registerCommands();

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
  // Typing outside a board is a Roam transaction. Park every board that does not
  // contain the caret before the keys land, and bring the visible ones back after a pause.
  let wakeTimer = null;
  let parkKey = null;
  const stopParkKeys = () => {
    if (!parkKey) return;
    doc.removeEventListener("keydown", parkKey, true);
    parkKey = null;
  };
  const wakeVisible = () => {
    wakeTimer = null;
    stopParkKeys();
    const height = win.innerHeight || 0;
    for (const rec of mounts.values()) {
      if (!rec.dormant) continue;
      const box = rec.mountEl.getBoundingClientRect?.();
      if (!box) continue;
      if (box.bottom > -60 && box.top < height + 60) wake(rec);
    }
  };
  const armWake = () => {
    if (wakeTimer) clearTimeout(wakeTimer);
    wakeTimer = setTimeout(wakeVisible, 700);
  };
  const watchParkKeys = () => {
    if (parkKey) return;
    parkKey = (event) => {
      if (!isTextEntryTarget(event.target)) return;
      parkOutside(event.target);
      armWake();
    };
    doc.addEventListener("keydown", parkKey, true);
  };
  const parkOutside = (target) => {
    if (!isTextEntryTarget(target)) return;
    let parked = false;
    for (const rec of mounts.values()) {
      if (rec.mountEl.contains?.(target) || rec.view?.root?.contains?.(target)) continue;
      if (rec.dormant || rec.fullscreen) continue;
      hibernate(rec);
      parked = rec.dormant || parked;
    }
    if (parked) watchParkKeys();
  };
  if (doc && typeof doc.addEventListener === "function") {
    lifecycle.event(doc, "focusin", (event) => { parkOutside(event.target); armWake(); });
    // `input` covers the burst after focus. A document keydown would sit beside the command sheet's own Escape listener.
    lifecycle.event(doc, "input", (event) => {
      if (!isTextEntryTarget(event.target)) return;
      parkOutside(event.target);
      armWake();
    }, true);
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
  lifecycle.add(() => { if (wakeTimer) clearTimeout(wakeTimer); stopParkKeys(); });
  if (typeof win.addEventListener === "function") {
    lifecycle.event(win, "hashchange", onNavigate);
    lifecycle.event(win, "popstate", onNavigate);
  }
  lifecycle.interval(reconcile, RECONCILE_INTERVAL_MS);
  // Registered last so it runs first on dispose: nothing may mount while teardown is in flight.
  lifecycle.add(() => { stopped = true; viewportWatch?.disconnect(); });
  reconcile();
}

export { enhancedUidGuardCss, findDiagramUidFromEl, isDiagramString, readEnhancedUidCache, writeEnhancedUidCache };
