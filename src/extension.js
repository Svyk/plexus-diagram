import { createLifecycle } from "./lifecycle.js";
import { installPlexusDiagram } from "./feature.js";
import { createSettingsPanel, initializeSettings } from "./settings.js";

let activeLifecycle = null;

export async function onload({ extensionAPI, extension }) {
  if (!extensionAPI) throw new TypeError("Roam did not provide extensionAPI");
  if (activeLifecycle) await activeLifecycle.dispose();

  const lifecycle = createLifecycle();
  activeLifecycle = lifecycle;
  try {
    await initializeSettings(extensionAPI);
    await lifecycle.settingsPanel(extensionAPI, createSettingsPanel());
    await installPlexusDiagram({ extensionAPI, lifecycle, version: extension?.version });
    console.info(`[plexus-diagram] Loaded v${extension?.version || "development"}`);
  } catch (error) {
    if (activeLifecycle === lifecycle) activeLifecycle = null;
    await lifecycle.dispose().catch((cleanupError) => console.error(cleanupError));
    throw error;
  }

  return async () => {
    if (activeLifecycle === lifecycle) activeLifecycle = null;
    await lifecycle.dispose();
  };
}

export async function onunload() {
  const lifecycle = activeLifecycle;
  activeLifecycle = null;
  if (lifecycle) await lifecycle.dispose();
  console.info("[plexus-diagram] Unloaded");
}

export { enhancedUidGuardCss, isDiagramString } from "./discovery.js";
export { settingsDefaults } from "./settings.js";
export { childrenFingerprint, importNativeLayout } from "./model.js";
export { buildEdgePath, arrowheadPoints } from "./edges.js";

export default { onload, onunload };
