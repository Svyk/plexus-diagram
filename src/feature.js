import {
  cssAttributeValue,
  diagramsWithin,
  diagramElForUid,
  diagramUidFromLocation,
  routeLeftZoomedDiagram,
  waitForDiagramEl,
  diagramInstanceInfo,
  enhancedUidGuardCss,
  findDiagramUidFromEl,
  graphCacheKey,
  isDiagramString,
  NATIVE_HIDDEN_CLASS,
  PREPAINT_STYLE_ID,
  readEnhancedUidCache,
  writeEnhancedUidCache,
} from "./discovery.js";
import { MetadataStore, releaseScratch } from "./metadata.js";
import { createLibrarySidebar } from "./library.js";
import { createSettingsReader, SETTING_IDS } from "./settings.js";
import { viewportCenterPosition, nestStack, parseDiagramTitle } from "./canvas.js";
import {
  allSessions,
  disposeSession,
  getOrCreateSession,
  getSession,
  NativeDiagramSession,
  pruneDetachedViews,
} from "./session.js";
import { markNativePending, mountDiagramView } from "./view.js";

export const runtime = {
  extensionAPI: null,
  lifecycle: null,
  metadata: null,
  settings: null,
  version: "0.4.2",
  enhancedUids: new Set(),
  activeDiagramUid: null,
  guardStyle: null,
  mounting: new Set(),
};

function enabled() {
  return runtime.settings?.get(SETTING_IDS.enabled) !== false;
}

function mobileBlocked() {
  return runtime.settings?.get(SETTING_IDS.disableOnMobile)
    && runtime.extensionAPI?.platform?.isMobile?.();
}

function guardDisabled() {
  return !enabled() || mobileBlocked();
}

function installGuard(uids) {
  if (typeof document === "undefined") return;
  if (guardDisabled()) {
    const style = document.getElementById(PREPAINT_STYLE_ID);
    if (style) style.textContent = "";
    return;
  }
  const style = document.getElementById(PREPAINT_STYLE_ID) || document.createElement("style");
  style.id = PREPAINT_STYLE_ID;
  style.textContent = enhancedUidGuardCss(uids);
  if (!style.isConnected) document.head.appendChild(style);
  runtime.guardStyle = style;
}

function syncGuard() {
  const uids = runtime.metadata?.enhancedUids?.() || [...runtime.enhancedUids];
  runtime.enhancedUids = new Set(uids);
  writeEnhancedUidCache(uids);
  installGuard(uids);
}

async function ensureMetadata() {
  if (!runtime.metadata) runtime.metadata = new MetadataStore();
  runtime.metadata.reload();
  const cached = readEnhancedUidCache();
  for (const uid of cached) {
    if (!runtime.metadata.has(uid)) runtime.metadata.diagrams.set(uid, { viewport: null, nodes: new Map(), edges: [], sections: new Map() });
  }
  syncGuard();
}

export function connectedMountForUid(uid, root = globalThis.document) {
  if (!uid || !root?.querySelector) return null;
  const mount = root.querySelector(`.pxd-mount[data-diagram-uid="${cssAttributeValue(uid)}"]`);
  return mount && mount.isConnected !== false ? mount : null;
}

function instanceAlreadyMounted(uid, nativeElement) {
  const adjacent = nativeElement?.nextElementSibling;
  if (adjacent?.classList?.contains?.("pxd-mount") && adjacent.isConnected !== false) return true;
  return Boolean(
    nativeElement?.classList?.contains?.(NATIVE_HIDDEN_CLASS) && connectedMountForUid(uid),
  );
}

async function enhanceDiagram(uid, nativeElement) {
  if (!enabled() || mobileBlocked()) {
    console.info("[plexus-diagram] Enhance skipped — extension disabled or mobile blocked");
    return;
  }
  if (!uid || !nativeElement) return;
  if (runtime.mounting.has(uid) || instanceAlreadyMounted(uid, nativeElement)) return;
  runtime.mounting.add(uid);
  try {
    if (!runtime.metadata) await ensureMetadata();
    await runtime.metadata.ensurePage();
    markNativePending(nativeElement);
    runtime.enhancedUids.add(uid);
    writeEnhancedUidCache(runtime.enhancedUids);
    installGuard(runtime.enhancedUids);
    const session = getOrCreateSession(uid, () => new NativeDiagramSession({
      diagramUid: uid,
      metadataStore: runtime.metadata,
      settings: runtime.settings,
      onChange: () => syncGuard(),
    }));
    pruneDetachedViews(session);
    session.load();
    session.startWatch();
    const layout = session.model.layoutSnapshot();
    if (!runtime.metadata.hasPersisted(uid)) {
      await runtime.metadata.set(uid, layout);
      await session.seedNativeViewport();
    } else if (!runtime.metadata.layoutMatchesStored(uid, layout)) {
      await runtime.metadata.set(uid, layout);
    }
    runtime.activeDiagramUid = uid;
    const mounted = mountDiagramView({
      nativeElement,
      session,
      settings: runtime.settings,
      version: runtime.version,
      lifecycle: runtime.lifecycle,
      onAction: async (action) => {
        if (action.type === "library") await toggleLibrary(mounted.wrapper, mounted.canvas);
        if (action.type === "nested" && action.uid) {
          await openNestedDiagram(action.uid);
        }
        if (action.type === "crumb" && action.uid) {
          await openCrumb(action.uid);
        }
        if (action.type === "open-block" && action.uid) {
          globalThis.roamAlphaAPI?.ui?.rightSidebar?.addWindow?.({ window: { type: "block", "block-uid": action.uid } });
        }
      },
    });
    if (runtime.settings.get(SETTING_IDS.showLibraryOnOpen)) await openLibrary(mounted.wrapper, mounted.canvas);
    syncGuard();
  } finally {
    runtime.mounting.delete(uid);
  }
}

async function restoreDiagram(uid) {
  disposeSession(uid);
  await runtime.metadata.remove(uid);
  runtime.enhancedUids.delete(uid);
  syncGuard();
}

function blockStringForUid(uid) {
  const pull = globalThis.roamAlphaAPI?.data?.pull?.(
    "[:block/string]",
    [":block/uid", uid],
  );
  return pull?.[":block/string"] ?? pull?.string ?? "";
}

function focusedDiagramUid() {
  const uid = globalThis.roamAlphaAPI?.ui?.getFocusedBlock?.()?.["block-uid"]
    || runtime.extensionAPI?.ui?.getFocusedBlock?.()?.["block-uid"];
  if (!uid) return null;
  return isDiagramString(blockStringForUid(uid)) ? uid : null;
}

async function resolveDiagramUid(context) {
  const candidates = [
    context?.["block-uid"],
    context?.uid,
    globalThis.roamAlphaAPI?.ui?.getFocusedBlock?.()?.["block-uid"],
    runtime.extensionAPI?.ui?.getFocusedBlock?.()?.["block-uid"],
  ];
  try {
    const view = await globalThis.roamAlphaAPI?.ui?.mainWindow?.getOpenView?.();
    if (view?.uid) candidates.push(view.uid);
  } catch { /* open view is optional */ }
  if (typeof document !== "undefined") {
    const visible = document.querySelector(".rm-diagram");
    if (visible) candidates.push(findDiagramUidFromEl(visible));
  }
  for (const uid of candidates) {
    if (uid && isDiagramString(blockStringForUid(uid))) return uid;
  }
  return null;
}

async function markEnhanced(uid) {
  if (!uid) return;
  await ensureMetadata();
  if (!runtime.metadata.has(uid)) {
    const empty = { viewport: null, nodes: new Map(), edges: [], sections: new Map() };
    try {
      await runtime.metadata.set(uid, empty);
    } catch {
      runtime.metadata.diagrams.set(uid, empty);
    }
  }
  runtime.enhancedUids.add(uid);
  writeEnhancedUidCache(runtime.enhancedUids);
  installGuard(runtime.enhancedUids);
}

async function enhanceByUid(uid) {
  if (!uid) {
    console.info("[plexus-diagram] Focus a {{[[diagram]]}} block first");
    return;
  }
  await markEnhanced(uid);
  let diagram = diagramElForUid(uid);
  if (!diagram && typeof document !== "undefined") diagram = await waitForDiagramEl(uid);
  if (!diagram) {
    console.info("[plexus-diagram] Native diagram canvas did not remount in time", uid);
    return;
  }
  await enhanceDiagram(uid, diagram);
}

async function openNestedDiagram(uid) {
  if (!uid) return;
  const parentUid = runtime.activeDiagramUid;
  if (parentUid && parentUid !== uid) {
    const title = parseDiagramTitle(blockStringForUid(parentUid)) || "Diagram";
    nestStack.push({ uid: parentUid, title });
  }
  await markEnhanced(uid);
  await globalThis.roamAlphaAPI?.ui?.mainWindow?.openBlock?.({ block: { uid } });
}

async function openCrumb(uid) {
  if (!uid) return;
  const pull = globalThis.roamAlphaAPI?.data?.pull?.(
    "[:node/title :block/string]",
    [":block/uid", uid],
  );
  const pageTitle = pull?.[":node/title"] ?? pull?.title;
  if (pageTitle) {
    await globalThis.roamAlphaAPI?.ui?.mainWindow?.openPage?.({ page: { uid } });
    return;
  }
  await globalThis.roamAlphaAPI?.ui?.mainWindow?.openBlock?.({ block: { uid } });
}

export function syncNestStackOnNavigate(hash = globalThis.location?.hash || "") {
  const openUid = diagramUidFromLocation(hash);
  if (nestStack.length && nestStack[nestStack.length - 1].uid === openUid) {
    nestStack.pop();
  }
}

let activeLibrary = null;

async function toggleLibrary(mountRoot, canvas) {
  const uid = runtime.activeDiagramUid || focusedDiagramUid();
  const session = uid ? getSession(uid) : null;
  if (!session) return;
  const root = mountRoot || document.querySelector(".pxd-root");
  if (activeLibrary?.isOpen?.()) {
    activeLibrary.close();
    activeLibrary = null;
    canvas?.setLibraryOpen?.(false);
    return;
  }
  activeLibrary = createLibrarySidebar({
    lifecycle: runtime.lifecycle,
    settings: runtime.settings,
    session,
    mountRoot: globalThis.document?.body || root,
    onClose: () => {
      activeLibrary = null;
      canvas?.setLibraryOpen?.(false);
    },
    onPlacePage: async (title) => {
      const center = root
        ? viewportCenterPosition(root, session, runtime.settings)
        : { x: 120, y: 120 };
      await session.addCard(`[[${title}]]`, center);
      session.notifyViews();
    },
  });
  canvas?.setLibraryOpen?.(true);
}

async function openLibrary(mountRoot, canvas) {
  if (activeLibrary?.isOpen?.()) return;
  await toggleLibrary(mountRoot, canvas);
}

function scanAddedNode(node) {
  for (const diagram of diagramsWithin(node)) {
    const uid = findDiagramUidFromEl(diagram);
    if (!uid) continue;
    if (!runtime.enhancedUids.has(uid)) {
      if (runtime.settings.get(SETTING_IDS.autoEnhance) && isDiagramString(blockStringForUid(uid))) {
        void enhanceDiagram(uid, diagram);
      }
      continue;
    }
    if (!diagram.classList.contains("pxd-native-hidden") && !diagram.nextElementSibling?.classList?.contains("pxd-mount")) {
      void enhanceDiagram(uid, diagram);
    }
  }
}

function installObservers(lifecycle) {
  if (typeof document === "undefined") return;
  const app = document.querySelector(".roam-app");
  if (app) {
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) scanAddedNode(node);
        }
      }
    });
    lifecycle.observer(observer, app, { childList: true, subtree: true });
    scanAddedNode(app);
  }
  const bodyObserver = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element) || !node.classList?.contains("bp3-portal")) continue;
        const portalObserver = new MutationObserver((portalRecords) => {
          for (const portalRecord of portalRecords) {
            for (const child of portalRecord.addedNodes) {
              if (child.nodeType === Node.ELEMENT_NODE) scanAddedNode(child);
            }
          }
        });
        lifecycle.observer(portalObserver, node, { childList: true, subtree: true });
        scanAddedNode(node);
      }
    }
  });
  lifecycle.observer(bodyObserver, document.body, { childList: true });
}
export async function reconcileVisibleDiagrams() {
  if (guardDisabled()) return;
  if (typeof document === "undefined") return;
  for (const session of allSessions().values()) pruneDetachedViews(session);
  const pageUid = diagramUidFromLocation();
  for (const uid of [...runtime.enhancedUids]) {
    if (connectedMountForUid(uid)) continue;
    let native = diagramElForUid(uid);
    if (!native && pageUid === uid) {
      // Zoomed block page: the visible diagram is this block, but its ancestors carry no
      // data-uid. Accept the lone native canvas unless it clearly belongs to another diagram.
      const candidate = document.querySelector(".rm-diagram");
      const candidateUid = candidate ? findDiagramUidFromEl(candidate) : null;
      if (candidate && (!candidateUid || candidateUid === uid)) native = candidate;
    }
    if (!native && pageUid === uid) native = await waitForDiagramEl(uid, { timeout: 400 });
    if (!native || native.isConnected === false) continue;
    if (connectedMountForUid(uid)) continue;
    await enhanceDiagram(uid, native);
  }
}

const RECONCILE_INTERVAL_MS = 250;

export function exitFullscreenOnNavigate(hash = globalThis.location?.hash || "") {
  if (typeof document === "undefined") return;
  const height = Number(runtime.settings?.get(SETTING_IDS.defaultHeight)) || 560;
  let left = false;
  for (const uid of [...runtime.enhancedUids]) {
    if (!routeLeftZoomedDiagram(uid, hash)) continue;
    left = true;
    const session = getSession(uid);
    for (const view of session?.views || []) {
      const fn = view.setFullscreen || view.canvas?.setFullscreen;
      fn?.(false);
    }
    const mount = connectedMountForUid(uid);
    if (!mount) continue;
    mount.classList.remove("pxd-mount--fullscreen", "pxd-mount--zoomed");
    mount.style.top = "";
    mount.style.left = "";
    mount.style.right = "";
    mount.style.bottom = "";
    mount.style.width = "";
    mount.style.height = `${height}px`;
    mount.style.minHeight = `${height}px`;
  }
  if (left) document.body?.classList?.remove("pxd-has-fullscreen");
}

function installReconcile(lifecycle) {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const trigger = () => {
    if (!runtime.enhancedUids.size) return;
    void reconcileVisibleDiagrams().catch((error) => console.warn("[plexus-diagram] Reconcile failed", error));
  };
  const onNavigate = () => {
    syncNestStackOnNavigate();
    exitFullscreenOnNavigate();
    trigger();
  };
  lifecycle.event(window, "hashchange", onNavigate);
  lifecycle.event(window, "popstate", onNavigate);
  lifecycle.interval(trigger, RECONCILE_INTERVAL_MS);
}

async function registerCommands(lifecycle, extensionAPI) {
  const run = async (label, fn) => {
    const full = `Plexus Diagram: ${label}`;
    const callback = (context) => {
      if (!enabled()) {
        console.info("[plexus-diagram] Command skipped — extension disabled");
        return;
      }
      void fn(context);
    };
    await lifecycle.command(extensionAPI.ui.commandPalette, { label: full, callback });
    if (extensionAPI.ui?.slashCommand?.addCommand) {
      await lifecycle.command(extensionAPI.ui.slashCommand, { label: full, callback });
    }
  };

  await run("Enhance this diagram", async (context) => {
    await enhanceByUid(await resolveDiagramUid(context));
  });
  await run("Restore native diagram", async () => {
    const uid = focusedDiagramUid() || runtime.activeDiagramUid;
    if (uid) await restoreDiagram(uid);
  });
  await run("Fullscreen this diagram", () => {
    const session = getSession(runtime.activeDiagramUid || focusedDiagramUid());
    const mount = document.querySelector(".pxd-mount");
    const next = !mount?.classList.contains("pxd-mount--fullscreen");
    if (session) {
      for (const view of session.views) {
        const fn = view.setFullscreen || view.canvas?.setFullscreen;
        fn?.(next);
      }
      return;
    }
    mount?.classList.toggle("pxd-mount--fullscreen", next);
    document.body.classList.toggle("pxd-has-fullscreen", next);
  });
}

async function registerSlashAndContext(lifecycle, extensionAPI) {
  if (extensionAPI.ui?.blockContextMenu?.addCommand) {
    await lifecycle.command(extensionAPI.ui.blockContextMenu, {
      label: "Plexus Diagram: Enhance",
      "display-conditional": (event) => isDiagramString(event["block-string"]),
      callback: async (event) => {
        await enhanceByUid(await resolveDiagramUid(event));
      },
    });
  }
}

export async function installPlexusDiagram({ extensionAPI, lifecycle, version }) {
  runtime.extensionAPI = extensionAPI;
  runtime.lifecycle = lifecycle;
  runtime.version = version || "0.4.2";
  runtime.settings = createSettingsReader(extensionAPI);
  runtime.enhancedUids = readEnhancedUidCache();
  installGuard(runtime.enhancedUids);
  await registerCommands(lifecycle, extensionAPI);
  await registerSlashAndContext(lifecycle, extensionAPI);
  installObservers(lifecycle);
  installReconcile(lifecycle);
  lifecycle.add(async () => {
    if (runtime.settings.get(SETTING_IDS.restoreNativeOnUnload)) {
      for (const uid of [...runtime.enhancedUids]) await restoreDiagram(uid);
    } else {
      for (const uid of [...allSessions().keys()]) disposeSession(uid);
    }
    await releaseScratch();
    nestStack.length = 0;
    runtime.metadata = null;
    runtime.guardStyle?.remove?.();
  });
  if (runtime.enhancedUids.size) await ensureMetadata();
}

export {
  enhancedUidGuardCss,
  findDiagramUidFromEl,
  graphCacheKey,
  isDiagramString,
  readEnhancedUidCache,
  writeEnhancedUidCache,
  openNestedDiagram,
  nestStack,
  parseDiagramTitle,
};
