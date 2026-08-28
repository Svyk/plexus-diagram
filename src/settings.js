export const SETTING_IDS = Object.freeze({
  enabled: "enabled",
  autoEnhance: "auto-enhance",
  showVersionBadge: "show-version-badge",
  restoreNativeOnUnload: "restore-native-on-unload",
  defaultHeight: "default-height",
  snapToGrid: "snap-to-grid",
  gridSize: "grid-size",
  showGrid: "show-grid",
  gridStyle: "grid-style",
  minimap: "minimap",
  panOnSpace: "pan-on-space",
  zoomMin: "zoom-min",
  zoomMax: "zoom-max",
  wheelZoom: "wheel-zoom",
  defaultCardWidth: "default-card-width",
  defaultCardHeight: "default-card-height",
  cardRadius: "card-radius",
  showCardTitle: "show-card-title",
  nativeBlockEditor: "native-block-editor",
  compactCards: "compact-cards",
  cardShadow: "card-shadow",
  renderChildrenDepth: "render-children-depth",
  connectorStyle: "connector-style",
  arrowheads: "arrowheads",
  edgeWidth: "edge-width",
  showEdgeLabels: "show-edge-labels",
  edgeAnimated: "edge-animated",
  showSections: "show-sections",
  sectionLabel: "section-label",
  showLibraryOnOpen: "show-library-on-open",
  libraryIncludeDailies: "library-include-dailies",
  followRoamTheme: "follow-roam-theme",
  viewportCulling: "viewport-culling",
  disableOnMobile: "disable-on-mobile",
  enableShortcuts: "enable-shortcuts",
});

const DEFAULTS = Object.freeze({
  [SETTING_IDS.enabled]: true,
  [SETTING_IDS.autoEnhance]: false,
  [SETTING_IDS.showVersionBadge]: true,
  [SETTING_IDS.restoreNativeOnUnload]: false,
  [SETTING_IDS.defaultHeight]: "560",
  [SETTING_IDS.snapToGrid]: true,
  [SETTING_IDS.gridSize]: "24",
  [SETTING_IDS.showGrid]: true,
  [SETTING_IDS.gridStyle]: "dots",
  [SETTING_IDS.minimap]: true,
  [SETTING_IDS.panOnSpace]: true,
  [SETTING_IDS.zoomMin]: "0.15",
  [SETTING_IDS.zoomMax]: "3",
  [SETTING_IDS.wheelZoom]: true,
  [SETTING_IDS.defaultCardWidth]: "280",
  [SETTING_IDS.defaultCardHeight]: "160",
  [SETTING_IDS.cardRadius]: "8",
  [SETTING_IDS.showCardTitle]: false,
  [SETTING_IDS.nativeBlockEditor]: true,
  [SETTING_IDS.compactCards]: false,
  [SETTING_IDS.cardShadow]: true,
  [SETTING_IDS.renderChildrenDepth]: "1",
  [SETTING_IDS.connectorStyle]: "bezier",
  [SETTING_IDS.arrowheads]: "end",
  [SETTING_IDS.edgeWidth]: "2",
  [SETTING_IDS.showEdgeLabels]: false,
  [SETTING_IDS.edgeAnimated]: false,
  [SETTING_IDS.showSections]: true,
  [SETTING_IDS.sectionLabel]: true,
  [SETTING_IDS.showLibraryOnOpen]: false,
  [SETTING_IDS.libraryIncludeDailies]: false,
  [SETTING_IDS.followRoamTheme]: true,
  [SETTING_IDS.viewportCulling]: true,
  [SETTING_IDS.disableOnMobile]: false,
  [SETTING_IDS.enableShortcuts]: true,
});

export function settingsDefaults() {
  return { ...DEFAULTS };
}

export function createSettingsReader(extensionAPI) {
  return {
    get(id) {
      const value = extensionAPI.settings.get(id);
      return value == null ? DEFAULTS[id] : value;
    },
  };
}

export async function initializeSettings(extensionAPI) {
  if (extensionAPI.settings.canSet === false) return;
  for (const [id, value] of Object.entries(DEFAULTS)) {
    if (extensionAPI.settings.get(id) == null) {
      await extensionAPI.settings.set(id, value);
    }
  }
}

function switchRow(id, name, description) {
  return {
    id,
    name,
    description,
    action: { type: "switch" },
  };
}

function inputRow(id, name, description) {
  return {
    id,
    name,
    description,
    action: { type: "input" },
  };
}

function selectRow(id, name, description, items) {
  return {
    id,
    name,
    description,
    action: { type: "select", items },
  };
}

export function createSettingsPanel() {
  return {
    tabTitle: "Plexus Diagram",
    settings: [
      switchRow(SETTING_IDS.enabled, "Enabled", "Master overlay toggle."),
      switchRow(SETTING_IDS.autoEnhance, "Auto enhance", "Enhance diagram blocks automatically when discovered."),
      switchRow(SETTING_IDS.showVersionBadge, "Show version badge", "Show the extension version in the toolbar."),
      switchRow(SETTING_IDS.restoreNativeOnUnload, "Restore native on unload", "Restore native diagrams when the extension unloads."),
      inputRow(SETTING_IDS.defaultHeight, "Default height", "Canvas host height in pixels."),
      switchRow(SETTING_IDS.snapToGrid, "Snap to grid", "Snap card positions to the grid."),
      inputRow(SETTING_IDS.gridSize, "Grid size", "Grid spacing in pixels."),
      switchRow(SETTING_IDS.showGrid, "Show grid", "Show the background grid."),
      selectRow(SETTING_IDS.gridStyle, "Grid style", "Background grid style.", [
        ["Dots", "dots"],
        ["Lines", "lines"],
        ["None", "none"],
      ]),
      switchRow(SETTING_IDS.minimap, "Minimap", "Show the minimap."),
      switchRow(SETTING_IDS.panOnSpace, "Pan on space", "Hold space and drag to pan."),
      inputRow(SETTING_IDS.zoomMin, "Zoom min", "Minimum zoom level."),
      inputRow(SETTING_IDS.zoomMax, "Zoom max", "Maximum zoom level."),
      switchRow(SETTING_IDS.wheelZoom, "Wheel zoom", "Zoom with the mouse wheel."),
      inputRow(SETTING_IDS.defaultCardWidth, "Default card width", "Default width for new cards."),
      inputRow(SETTING_IDS.defaultCardHeight, "Default card height", "Default height for new cards."),
      inputRow(SETTING_IDS.cardRadius, "Card radius", "Card corner radius in pixels."),
      switchRow(SETTING_IDS.showCardTitle, "Show card title", "Show a title bar on cards."),
      switchRow(SETTING_IDS.nativeBlockEditor, "Native block editor", "Use Roam's native block renderer inside cards."),
      switchRow(SETTING_IDS.compactCards, "Compact cards", "Use compact card chrome."),
      switchRow(SETTING_IDS.cardShadow, "Card shadow", "Draw a subtle card shadow."),
      selectRow(SETTING_IDS.renderChildrenDepth, "Render children depth", "How many child levels to render.", [
        ["0", "0"],
        ["1", "1"],
        ["2", "2"],
        ["All", "all"],
      ]),
      selectRow(SETTING_IDS.connectorStyle, "Connector style", "Default edge style.", [
        ["Bezier", "bezier"],
        ["Straight", "straight"],
        ["Elbow", "elbow"],
      ]),
      selectRow(SETTING_IDS.arrowheads, "Arrowheads", "Arrowhead placement.", [
        ["End", "end"],
        ["Both", "both"],
        ["None", "none"],
      ]),
      inputRow(SETTING_IDS.edgeWidth, "Edge width", "Connector stroke width."),
      switchRow(SETTING_IDS.showEdgeLabels, "Show edge labels", "Show labels on connectors."),
      switchRow(SETTING_IDS.edgeAnimated, "Edge animated", "Animate connectors."),
      switchRow(SETTING_IDS.showSections, "Show sections", "Render section frames."),
      switchRow(SETTING_IDS.sectionLabel, "Section label", "Show section titles."),
      switchRow(SETTING_IDS.showLibraryOnOpen, "Show library on open", "Open the library when enhancing."),
      switchRow(SETTING_IDS.libraryIncludeDailies, "Library include dailies", "Include daily pages in the library."),
      switchRow(SETTING_IDS.followRoamTheme, "Follow Roam theme", "Follow Roam light/dark theme."),
      switchRow(SETTING_IDS.viewportCulling, "Viewport culling", "Skip rendering off-screen cards."),
      switchRow(SETTING_IDS.disableOnMobile, "Disable on mobile", "Skip mounting on mobile clients."),
      switchRow(SETTING_IDS.enableShortcuts, "Enable shortcuts", "Enable keyboard shortcuts."),
    ],
  };
}
