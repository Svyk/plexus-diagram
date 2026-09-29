export const SETTING_IDS = Object.freeze({
  enabled: "enabled",
  fullscreenOnZoom: "fullscreen-on-zoom",
  graphLinks: "graph-links",
  wheel: "wheel",
  showMinimap: "show-minimap",
  snapGuides: "snap-guides",
  grid: "grid",
  defaultCardWidth: "default-card-width",
  defaultCardHeight: "default-card-height",
  enableShortcuts: "enable-shortcuts",
  showVersionBadge: "show-version-badge",
  disableOnMobile: "disable-on-mobile",
});

const DEFAULTS = Object.freeze({
  [SETTING_IDS.enabled]: true,
  [SETTING_IDS.fullscreenOnZoom]: true,
  [SETTING_IDS.graphLinks]: "all",
  [SETTING_IDS.wheel]: "pan",
  [SETTING_IDS.showMinimap]: true,
  [SETTING_IDS.snapGuides]: true,
  [SETTING_IDS.grid]: "dots",
  [SETTING_IDS.defaultCardWidth]: 280,
  [SETTING_IDS.defaultCardHeight]: 160,
  [SETTING_IDS.enableShortcuts]: true,
  [SETTING_IDS.showVersionBadge]: true,
  [SETTING_IDS.disableOnMobile]: true,
});

const ENUMS = Object.freeze({
  [SETTING_IDS.graphLinks]: ["off", "attributes", "all"],
  [SETTING_IDS.wheel]: ["pan", "zoom"],
  [SETTING_IDS.grid]: ["dots", "lines", "plain"],
});

const NUMBERS = new Set([SETTING_IDS.defaultCardWidth, SETTING_IDS.defaultCardHeight]);

export function settingsDefaults() {
  return { ...DEFAULTS };
}

// Roam stores switches as booleans and inputs as strings; coerce to the default's type.
export function normalizeSetting(id, value) {
  const fallback = DEFAULTS[id];
  if (value == null || value === "") return fallback;
  if (typeof fallback === "boolean") {
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    return fallback;
  }
  if (NUMBERS.has(id)) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 40 ? n : fallback;
  }
  if (ENUMS[id]) return ENUMS[id].includes(value) ? value : fallback;
  return value;
}

export function readSettings(extensionAPI) {
  const out = {};
  for (const id of Object.keys(DEFAULTS)) {
    let raw = null;
    try {
      raw = extensionAPI?.settings?.get?.(id);
    } catch {
      raw = null;
    }
    out[id] = normalizeSetting(id, raw);
  }
  return out;
}

export async function initializeSettings(extensionAPI) {
  if (extensionAPI.settings.canSet === false) return;
  for (const [id, value] of Object.entries(DEFAULTS)) {
    if (extensionAPI.settings.get(id) == null) {
      await extensionAPI.settings.set(id, value);
    }
  }
}

const listeners = new Set();

export function onSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(id, value) {
  for (const fn of [...listeners]) {
    try {
      fn(id, value);
    } catch (error) {
      console.error("[plexus-diagram] Settings listener failed", error);
    }
  }
}

function switchRow(id, name, description) {
  return {
    id,
    name,
    description,
    action: { type: "switch", onChange: (event) => emit(id, event?.target?.checked ?? event) },
  };
}

function inputRow(id, name, description) {
  return {
    id,
    name,
    description,
    action: { type: "input", onChange: (event) => emit(id, event?.target?.value ?? event) },
  };
}

function selectRow(id, name, description, items) {
  return {
    id,
    name,
    description,
    action: { type: "select", items, onChange: (value) => emit(id, value?.target?.value ?? value) },
  };
}

export function createSettingsPanel() {
  return {
    tabTitle: "Plexus Diagram",
    settings: [
      switchRow(SETTING_IDS.enabled, "Enabled", "Master overlay toggle."),
      switchRow(SETTING_IDS.fullscreenOnZoom, "Fullscreen on zoom", "Open enhanced diagrams full screen when zoomed into the diagram block. Esc exits."),
      selectRow(SETTING_IDS.graphLinks, "Graph links", "Show links between cards derived from page references and attributes.", ["all", "attributes", "off"]),
      selectRow(SETTING_IDS.wheel, "Mouse wheel", "What the mouse wheel does on the board. Pinch always zooms.", ["pan", "zoom"]),
      switchRow(SETTING_IDS.showMinimap, "Show minimap", "Show the minimap."),
      switchRow(SETTING_IDS.snapGuides, "Snap guides", "Align dragged cards to neighbours and show guides."),
      selectRow(SETTING_IDS.grid, "Grid", "Board background.", ["dots", "lines", "plain"]),
      inputRow(SETTING_IDS.defaultCardWidth, "Default card width", "Width in pixels for new cards."),
      inputRow(SETTING_IDS.defaultCardHeight, "Default card height", "Height in pixels for new cards."),
      switchRow(SETTING_IDS.enableShortcuts, "Enable shortcuts", "Enable board keyboard shortcuts."),
      switchRow(SETTING_IDS.showVersionBadge, "Show version badge", "Show the extension version in the toolbar."),
      switchRow(SETTING_IDS.disableOnMobile, "Disable on mobile", "Skip mounting on mobile clients."),
    ],
  };
}
