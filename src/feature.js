import {
  diagramsWithin,
  diagramElForUid,
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
  version: "0.1.1",
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
  mountDiagramView({
    nativeElement,
    session,
    settings: runtime.settings,
    version: runtime.version,
    lifecycle: runtime.lifecycle,
    onAction: async (action) => {
      if (action.type === "library") await openLibrary();
      if (action.type === "nested" && action.uid) {
        runtime.extensionAPI?.ui?.mainWindow?.openBlock?.({ block: { uid: action.uid } });
      }
    },
  });
  if (runtime.settings.get(SETTING_IDS.showLibraryOnOpen)) await openLibrary();
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
  const uid = runtime.extensionAPI?.ui?.getFocusedBlock?.()?.["block-uid"];
  if (!uid) return null;
  return isDiagramString(blockStringForUid(uid)) ? uid : null;
}

async function openLibrary(mountRoot) {
  const uid = runtime.activeDiagramUid || focusedDiagramUid();
  const session = uid ? getSession(uid) : null;
  if (!session) return;
  const root = mountRoot || document.querySelector(".pxd-root");
  createLibrarySidebar({
    lifecycle: runtime.lifecycle,
    settings: runtime.settings,
    session,
    mountRoot: root,
    onPlacePage: async (title) => {
      const center = root
        ? viewportCenterPosition(root, session, runtime.settings)
        : { x: 120, y: 120 };
      await session.addCard(`[[${title}]]`, center);
    },
  });
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

function registerCommands(lifecycle, extensionAPI) {
  const run = (label, fn) => lifecycle.command(extensionAPI.ui.commandPalette, {
    label: `Plexus Diagram: ${label}`,
    callback: () => {
      if (!enabled()) {
        console.info("[plexus-diagram] Command skipped — extension disabled");
        return;
      }
      void fn();
    },
  });

  run("Enhance this diagram", async () => {
    const uid = focusedDiagramUid();
    if (!uid) return;
    const diagram = diagramElForUid(uid) || document.querySelector(".rm-diagram");
    if (diagram) await enhanceDiagram(uid, diagram);
  });
  run("Restore native diagram", async () => {
    const uid = focusedDiagramUid() || runtime.activeDiagramUid;
    if (uid) await restoreDiagram(uid);
  });
  run("Add card", async () => {
    const uid = runtime.activeDiagramUid || focusedDiagramUid();
    const session = uid ? getSession(uid) : null;
    if (!session) return;
    await session.addCard("", { x: 80, y: 80 });
  });
  run("Connect selected", async () => {
    const session = getSession(runtime.activeDiagramUid || focusedDiagramUid());
    if (!session) return;
    await session.connectSelected(runtime.settings.get(SETTING_IDS.connectorStyle));
  });
  run("Toggle connect tool", () => {
    const session = getSession(runtime.activeDiagramUid || focusedDiagramUid());
    if (!session) return;
    session.model.activeTool = session.model.activeTool === "connect" ? "select" : "connect";
  });
  run("Open nested diagram", () => {
    const session = getSession(runtime.activeDiagramUid || focusedDiagramUid());
    const uid = [...(session?.model.selected || [])][0];
    if (uid) extensionAPI.ui?.mainWindow?.openBlock?.({ block: { uid } });
  });
  run("Show library", () => openLibrary());
  run("Appearances of this block", () => {
    const focused = extensionAPI.ui?.getFocusedBlock?.()?.["block-uid"];
    if (!focused) return;
    const rows = globalThis.roamAlphaAPI?.data?.q?.(`[:find ?diagram :where
      [?child :block/uid "${focused}"]
      [?diagram :block/children ?child]]`) || [];
    console.info("[plexus-diagram] Appearances:", rows);
  });
  run("Snap selection to grid", async () => {
    const session = getSession(runtime.activeDiagramUid || focusedDiagramUid());
    if (!session) return;
    session.model.snapSelectionToGrid(Number(runtime.settings.get(SETTING_IDS.gridSize)) || 24);
    await session.persistLayout();
    session.notifyViews();
  });
  run("Auto-layout", async () => {
    const session = getSession(runtime.activeDiagramUid || focusedDiagramUid());
    if (!session) return;
    session.model.autoLayoutGrid(true, Number(runtime.settings.get(SETTING_IDS.gridSize)) || 24);
    await session.persistLayout();
    session.notifyViews();
  });
}

function registerSlashAndContext(lifecycle, extensionAPI) {
  if (extensionAPI.ui?.slashCommand?.addCommand) {
    lifecycle.command(extensionAPI.ui.slashCommand, {
      label: "Plexus Diagram",
      callback: async (context) => {
        if (!enabled()) return;
        const blockUid = context["block-uid"];
        const string = blockStringForUid(blockUid);
        const diagramUid = focusedDiagramUid() || (isDiagramString(string) ? blockUid : null);
        if (diagramUid) {
          const diagram = diagramElForUid(diagramUid);
          if (diagram) await enhanceDiagram(diagramUid, diagram);
          return;
        }
        if (string && string.trim() && !isDiagramString(string)) return;
        await globalThis.roamAlphaAPI?.data?.block?.update?.({
          block: { uid: blockUid, string: "{{[[diagram]]}}" },
        });
      },
    });
  }
  if (extensionAPI.ui?.blockContextMenu?.addCommand) {
    lifecycle.command(extensionAPI.ui.blockContextMenu, {
      label: "Plexus Diagram: Enhance",
      "display-conditional": (event) => isDiagramString(event["block-string"]),
      callback: async (event) => {
        const uid = event["block-uid"];
        const diagram = diagramElForUid(uid);
        if (diagram) await enhanceDiagram(uid, diagram);
      },
    });
  }
}

export async function installPlexusDiagram({ extensionAPI, lifecycle, version }) {
  runtime.extensionAPI = extensionAPI;
  runtime.lifecycle = lifecycle;
  runtime.version = version || "0.1.1";
  runtime.settings = createSettingsReader(extensionAPI);
  runtime.enhancedUids = readEnhancedUidCache();
  installGuard(runtime.enhancedUids);
  registerCommands(lifecycle, extensionAPI);
  registerSlashAndContext(lifecycle, extensionAPI);
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
