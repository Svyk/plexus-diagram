import pkg from "../package.json" with { type: "json" };
import { createHost } from "./host/roam.js";
import { acquireSession as acquireSessionDefault } from "./session.js";
import { mountBoardView } from "./view/board-view.js";
import {
  diagramsWithin,
  diagramUidFromLocation,
  enhancedUidGuardCss,
  findDiagramUidFromEl,
  isDiagramString,
  NATIVE_HIDDEN_CLASS,
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
  let stopped = false;
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

  function mount(uid, native) {
    const mountEl = doc.createElement("div");
    mountEl.className = "pxd-mount";
    mountEl.dataset.diagramUid = uid;
    const titlePanel = titlePanelOf(native);
    const rec = {
      uid,
      native,
      mountEl,
      titlePanel,
      titleDisplay: titlePanel ? titlePanel.style.display : "",
      session: null,
      view: null,
      fullscreen: false,
      off: null,
    };
    native.classList.add(NATIVE_HIDDEN_CLASS);
    if (titlePanel) titlePanel.style.display = "none";
    native.after(mountEl);
    mounts.set(native, rec);
    try {
      rec.session = acquireSession(uid, { host, settings });
      rec.fullscreen = settings[SETTING_IDS.fullscreenOnZoom] !== false
        && !routeLeftZoomedDiagram(uid);
      rec.view = mountView({
        host,
        session: rec.session,
        mountEl,
        nativeEl: native,
        settings,
        fullscreen: rec.fullscreen,
        version: badge,
        onRequestFullscreen: (want) => setFullscreen(rec, want === undefined ? !rec.fullscreen : want),
      });
      rec.off = rec.session.on?.("change", () => {
        // Restore (or an external props edit / undo) removed :plexus: give the native diagram back.
        if (rec.session.board && rec.session.board.enhanced === false && !legacyUids.has(uid)) {
          markNative(uid);
          unmount(rec);
        }
      });
    } catch (error) {
      console.error("[plexus-diagram] Mount failed; native diagram restored", error);
      negativeUntil.set(uid, Date.now() + 10 * NEGATIVE_TTL_MS);
      unmount(rec);
      return null;
    }
    migrateLegacy(rec);
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

  function unmount(rec) {
    if (!rec || !mounts.has(rec.native)) return;
    mounts.delete(rec.native);
    try { rec.off?.(); } catch { /* ignore */ }
    try { rec.view?.dispose?.(); } catch (error) { console.warn("[plexus-diagram] view dispose failed", error); }
    try { rec.session?.release?.(); } catch (error) { console.warn("[plexus-diagram] session release failed", error); }
    rec.mountEl.remove();
    rec.native.classList.remove(NATIVE_HIDDEN_CLASS);
    if (rec.titlePanel) rec.titlePanel.style.display = rec.titleDisplay;
  }

  const uidByNative = new WeakMap();

  function consider(native) {
    if (stopped || !native || mounts.has(native) || native.isConnected === false) return;
    if (!active()) return;
    let uid = uidByNative.get(native);
    if (uid === undefined) {
      uid = findDiagramUidFromEl(native, (candidate) => isDiagramString(host.blockString?.(candidate))) || null;
      uidByNative.set(native, uid);
    }
    if (!uid || !isBoardEnhanced(uid)) return;
    mount(uid, native);
  }

  function scanAdded(node) {
    for (const diagram of diagramsWithin(node)) consider(diagram);
  }

  function reconcile() {
    if (stopped) return;
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
      const hit = rows.find((row) => isDiagramString(row[1]));
      return hit ? hit[0] : null;
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
    const session = acquireSession(uid, { host, settings });
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
    const session = acquireSession(uid, { host, settings });
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

  async function registerCommands() {
    const commands = [
      ["Plexus: Enhance this diagram", enhanceCommand],
      ["Plexus: New whiteboard here", newWhiteboardCommand],
      ["Plexus: Restore native diagram", restoreCommand],
      ["Plexus: Fullscreen this diagram", fullscreenCommand],
    ];
    for (const [label, fn] of commands) {
      const callback = (context) => {
        if (!active()) {
          console.info("[plexus-diagram] Command skipped: extension disabled");
          return;
        }
        Promise.resolve(fn(context)).catch((error) => console.warn(`[plexus-diagram] ${label} failed`, error));
      };
      await lifecycle.command(extensionAPI.ui.commandPalette, { label, callback });
      if (extensionAPI.ui?.slashCommand?.addCommand) {
        await lifecycle.command(extensionAPI.ui.slashCommand, { label, callback });
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
    }
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
        } else {
          const native = rec.native;
          unmount(rec);
          consider(native);
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
      fullscreen: rec.fullscreen,
      connected: rec.native.isConnected !== false && rec.mountEl.isConnected !== false,
    })),
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
  if (typeof win.addEventListener === "function") {
    lifecycle.event(win, "hashchange", onNavigate);
    lifecycle.event(win, "popstate", onNavigate);
  }
  lifecycle.interval(reconcile, RECONCILE_INTERVAL_MS);
  // Registered last so it runs first on dispose: nothing may mount while teardown is in flight.
  lifecycle.add(() => { stopped = true; });
  reconcile();
}

export { enhancedUidGuardCss, findDiagramUidFromEl, isDiagramString, readEnhancedUidCache, writeEnhancedUidCache };
