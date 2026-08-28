import {
  diagramsWithin,
  diagramElForUid,
  waitForDiagramEl,
  diagramInstanceInfo,
  enhancedUidGuardCss,
  findDiagramUidFromEl,
  graphCacheKey,
  isDiagramString,
  PREPAINT_STYLE_ID,
  readEnhancedUidCache,
  writeEnhancedUidCache,
} from "./discovery.js";
import { MetadataStore } from "./metadata.js";
import { createLibrarySidebar } from "./library.js";
import { createSettingsReader, SETTING_IDS } from "./settings.js";
import { viewportCenterPosition } from "./canvas.js";
import {
  allSessions,
  disposeSession,
  getOrCreateSession,
  getSession,
  NativeDiagramSession,
} from "./session.js";
import { markNativePending, mountDiagramView } from "./view.js";

export const runtime = {
  extensionAPI: null,
  lifecycle: null,
  metadata: null,
  settings: null,
  version: "0.2.0",
  enhancedUids: new Set(),
  activeDiagramUid: null,
  guardStyle: null,
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

async function enhanceDiagram(uid, nativeElement) {
  if (!enabled() || mobileBlocked()) {
    console.info("[plexus-diagram] Enhance skipped — extension disabled or mobile blocked");
    return;
  }
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
  session.load();
  session.startWatch();
  const layout = session.model.layoutSnapshot();
  await runtime.metadata.set(uid, layout);
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
        globalThis.roamAlphaAPI?.ui?.mainWindow?.openBlock?.({ block: { uid: action.uid } });
      }
    },
  });
  if (runtime.settings.get(SETTING_IDS.showLibraryOnOpen)) await openLibrary(mounted.wrapper, mounted.canvas);
  syncGuard();
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

async function enhanceByUid(uid) {
  if (!uid) {
    console.info("[plexus-diagram] Focus a {{[[diagram]]}} block first");
    return;
  }
  await ensureMetadata();
  runtime.enhancedUids.add(uid);
  writeEnhancedUidCache(runtime.enhancedUids);
  installGuard(runtime.enhancedUids);
  let diagram = diagramElForUid(uid);
  if (!diagram && typeof document !== "undefined") diagram = document.querySelector(".rm-diagram");
  if (!diagram) diagram = await waitForDiagramEl(uid);
  if (!diagram) {
    console.info("[plexus-diagram] Native diagram canvas did not remount in time", uid);
    return;
  }
  await enhanceDiagram(uid, diagram);
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
    mountRoot: root,
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
  await run("Add card", async () => {
    const uid = runtime.activeDiagramUid || focusedDiagramUid();
    const session = uid ? getSession(uid) : null;
    if (!session) return;
    await session.addCard("", { x: 80, y: 80 });
  });
  await run("Connect selected", async () => {
    const session = getSession(runtime.activeDiagramUid || focusedDiagramUid());
    if (!session) return;
    await session.connectSelected(runtime.settings.get(SETTING_IDS.connectorStyle));
  });
  await run("Toggle connect tool", () => {
    const session = getSession(runtime.activeDiagramUid || focusedDiagramUid());
    if (!session) return;
    session.model.activeTool = session.model.activeTool === "connect" ? "select" : "connect";
  });
  await run("Open nested diagram", () => {
    const session = getSession(runtime.activeDiagramUid || focusedDiagramUid());
    const uid = [...(session?.model.selected || [])][0];
    if (uid) globalThis.roamAlphaAPI?.ui?.mainWindow?.openBlock?.({ block: { uid } });
  });
  await run("Show library", () => openLibrary());
  await run("Appearances of this block", () => {
    const focused = extensionAPI.ui?.getFocusedBlock?.()?.["block-uid"];
    if (!focused) return;
    const rows = globalThis.roamAlphaAPI?.data?.q?.(`[:find ?diagram :where
      [?child :block/uid "${focused}"]
      [?diagram :block/children ?child]]`) || [];
    console.info("[plexus-diagram] Appearances:", rows);
  });
  await run("Snap selection to grid", async () => {
    const session = getSession(runtime.activeDiagramUid || focusedDiagramUid());
    if (!session) return;
    session.model.snapSelectionToGrid(Number(runtime.settings.get(SETTING_IDS.gridSize)) || 24);
    await session.persistLayout();
    session.notifyViews();
  });
  await run("Auto-layout", async () => {
    const session = getSession(runtime.activeDiagramUid || focusedDiagramUid());
    if (!session) return;
    session.model.autoLayoutGrid(true, Number(runtime.settings.get(SETTING_IDS.gridSize)) || 24);
    await session.persistLayout();
    session.notifyViews();
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
  runtime.version = version || "0.2.0";
  runtime.settings = createSettingsReader(extensionAPI);
  runtime.enhancedUids = readEnhancedUidCache();
  installGuard(runtime.enhancedUids);
  await registerCommands(lifecycle, extensionAPI);
  await registerSlashAndContext(lifecycle, extensionAPI);
  installObservers(lifecycle);
  lifecycle.add(async () => {
    if (runtime.settings.get(SETTING_IDS.restoreNativeOnUnload)) {
      for (const uid of [...runtime.enhancedUids]) await restoreDiagram(uid);
    } else {
      for (const uid of [...allSessions().keys()]) disposeSession(uid);
    }
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
};
