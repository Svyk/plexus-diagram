import "./session-clip.js";
import "./templates.js";
import "./snapshots.js";
import "./views.js";
import { createLifecycle } from "./lifecycle.js";
import { installPlexusDiagram } from "./feature.js";
import { createSettingsPanel, initializeSettings } from "./settings.js";

let activeLifecycle = null;
let ourTeardown = null;

function plexusWindow() {
  return globalThis.window ?? globalThis;
}

function detachTeardown(win, fn) {
  if (fn && win.__plexusDiagramTeardown === fn) delete win.__plexusDiagramTeardown;
  if (ourTeardown === fn) ourTeardown = null;
}

export async function onload({ extensionAPI, extension, deps }) {
  if (!extensionAPI) throw new TypeError("Roam did not provide extensionAPI");
  const win = plexusWindow();
  // A re-evaluated bundle cannot see the previous copy's module state. Its teardown
  // lives on the window; call it before this copy installs.
  const prior = win.__plexusDiagramTeardown;
  if (typeof prior === "function" && prior !== ourTeardown) {
    try { await prior(); }
    catch (error) { console.error("[plexus-diagram] previous copy teardown failed", error); }
    if (win.__plexusDiagramTeardown === prior) delete win.__plexusDiagramTeardown;
  }
  if (activeLifecycle) await activeLifecycle.dispose();

  const lifecycle = createLifecycle();
  activeLifecycle = lifecycle;
  const dispose = async () => {
    detachTeardown(win, dispose);
    if (activeLifecycle === lifecycle) activeLifecycle = null;
    await lifecycle.dispose();
  };
  try {
    await initializeSettings(extensionAPI);
    await lifecycle.settingsPanel(extensionAPI, createSettingsPanel());
    await installPlexusDiagram({ extensionAPI, lifecycle, version: extension?.version, ...deps });
    console.info(`[plexus-diagram] Loaded v${extension?.version || "development"}`);
  } catch (error) {
    if (activeLifecycle === lifecycle) activeLifecycle = null;
    await lifecycle.dispose().catch((cleanupError) => console.error(cleanupError));
    throw error;
  }

  ourTeardown = dispose;
  win.__plexusDiagramTeardown = dispose;
  return dispose;
}

export async function onunload() {
  const win = plexusWindow();
  const fn = ourTeardown;
  if (fn && win.__plexusDiagramTeardown === fn) delete win.__plexusDiagramTeardown;
  ourTeardown = null;
  const lifecycle = activeLifecycle;
  activeLifecycle = null;
  if (lifecycle) await lifecycle.dispose();
  console.info("[plexus-diagram] Unloaded");
}

export { enhancedUidGuardCss, isDiagramString } from "./discovery.js";
export { settingsDefaults } from "./settings.js";

export default { onload, onunload };
