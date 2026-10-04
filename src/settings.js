export const SETTING_IDS = Object.freeze({
  enabled: "enabled",
  fullscreenOnZoom: "fullscreen-on-zoom",
  graphLinks: "graph-links",
  attrStyles: "attr-styles",
  wheel: "wheel",
  showMinimap: "show-minimap",
  controlsPosition: "controls-position",
  snapGuides: "snap-guides",
  snapGrid: "snap-grid",
  grid: "grid",
  defaultCardWidth: "default-card-width",
  defaultCardHeight: "default-card-height",
  defaultCardLook: "default-card-look",
  enableShortcuts: "enable-shortcuts",
  showVersionBadge: "show-version-badge",
  disableOnMobile: "disable-on-mobile",
  collapseOutline: "collapse-outline",
  boardTone: "board-tone",
  mapZoom: "map-zoom",
  autoFitSections: "auto-fit-sections",
  spaceOut: "space-out",
  showCardBadges: "show-card-badges",
  showPalette: "show-palette",
  motion: "motion",
  enterInCard: "enter-in-card",
  toolbarLayout: "toolbar-layout",
  dockPosition: "dock-position",
  dockStyle: "dock-style",
  dockLabels: "dock-labels",
  chromeDensity: "chrome-density",
  dockOptions: "dock-options",
});

const DEFAULTS = Object.freeze({
  [SETTING_IDS.enabled]: true,
  [SETTING_IDS.fullscreenOnZoom]: true,
  [SETTING_IDS.graphLinks]: "all",
  [SETTING_IDS.attrStyles]: "",
  [SETTING_IDS.wheel]: "pan",
  [SETTING_IDS.showMinimap]: true,
  [SETTING_IDS.controlsPosition]: "rail",
  [SETTING_IDS.snapGuides]: true,
  [SETTING_IDS.snapGrid]: false,
  [SETTING_IDS.grid]: "dots",
  [SETTING_IDS.defaultCardWidth]: 280,
  [SETTING_IDS.defaultCardHeight]: 160,
  [SETTING_IDS.defaultCardLook]: "block",
  [SETTING_IDS.enableShortcuts]: true,
  [SETTING_IDS.showVersionBadge]: true,
  [SETTING_IDS.disableOnMobile]: true,
  [SETTING_IDS.collapseOutline]: true,
  [SETTING_IDS.boardTone]: "none",
  [SETTING_IDS.mapZoom]: "0.45",
  [SETTING_IDS.autoFitSections]: true,
  [SETTING_IDS.spaceOut]: false,
  [SETTING_IDS.showCardBadges]: true,
  [SETTING_IDS.showPalette]: true,
  [SETTING_IDS.motion]: "full",
  [SETTING_IDS.enterInCard]: "newline",
  [SETTING_IDS.toolbarLayout]: "split",
  [SETTING_IDS.dockPosition]: "bottom",
  [SETTING_IDS.dockStyle]: "pill",
  [SETTING_IDS.dockLabels]: false,
  [SETTING_IDS.chromeDensity]: "comfortable",
  [SETTING_IDS.dockOptions]: true,
});

const BOARD_TONES = ["none", "paper", "gray", "red", "orange", "yellow", "green", "teal", "blue", "indigo", "purple", "pink"];
const MAP_ZOOMS = ["0.3", "0.45", "0.6"];

const ENUMS = Object.freeze({
  [SETTING_IDS.graphLinks]: ["off", "attributes", "all"],
  [SETTING_IDS.wheel]: ["pan", "zoom"],
  [SETTING_IDS.controlsPosition]: ["rail", "bar"],
  [SETTING_IDS.grid]: ["dots", "lines", "grid", "plain"],
  [SETTING_IDS.defaultCardLook]: ["block", "card"],
  [SETTING_IDS.boardTone]: BOARD_TONES,
  [SETTING_IDS.mapZoom]: MAP_ZOOMS,
  [SETTING_IDS.motion]: ["full", "reduced", "none"],
  [SETTING_IDS.enterInCard]: ["newline", "child"],
  [SETTING_IDS.toolbarLayout]: ["split", "classic", "dock-only"],
  [SETTING_IDS.dockPosition]: ["bottom", "left", "top"],
  [SETTING_IDS.dockStyle]: ["pill", "strip"],
  [SETTING_IDS.chromeDensity]: ["comfortable", "compact"],
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
  if (ENUMS[id]) {
    const text = typeof value === "number" ? String(value) : value;
    return ENUMS[id].includes(text) ? text : fallback;
  }
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

// The panel is built after this runs. Reset reads the same object at click time.
let settingsStore = null;

export async function initializeSettings(extensionAPI) {
  settingsStore = extensionAPI ?? null;
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

function groupRow(id, name, description) {
  return {
    id,
    name,
    description,
    action: { type: "reactComponent", component: () => null },
  };
}

// Persists each default, then tells open boards. The listener calls setSettings, so the view stays mounted.
export async function resetPlexusSettings() {
  const defaults = settingsDefaults();
  for (const [id, value] of Object.entries(defaults)) {
    try {
      await settingsStore?.settings?.set?.(id, value);
    } catch (error) {
      console.warn("[plexus-diagram] Could not reset setting", id, error);
    }
    emit(id, value);
  }
}

const SETTING_ROWS = {
  [SETTING_IDS.enabled]: () => switchRow(SETTING_IDS.enabled, "Enabled", "Turn the diagram overlay on or off."),
  [SETTING_IDS.fullscreenOnZoom]: () => switchRow(SETTING_IDS.fullscreenOnZoom, "Fullscreen on zoom", "Open a diagram full screen when you zoom into its block. Esc leaves it."),
  [SETTING_IDS.graphLinks]: () => selectRow(SETTING_IDS.graphLinks, "Graph links", "Show lines between cards that share a page reference or an attribute.", ["all", "attributes", "off"]),
  [SETTING_IDS.attrStyles]: () => inputRow(SETTING_IDS.attrStyles, "Attribute styles", "One JSON object. Each attribute name gets a palette color and a line: solid, dashed, or dotted."),
  [SETTING_IDS.wheel]: () => selectRow(SETTING_IDS.wheel, "Mouse wheel", "What the mouse wheel does on the board. Pinch still zooms.", ["pan", "zoom"]),
  [SETTING_IDS.showMinimap]: () => switchRow(SETTING_IDS.showMinimap, "Show minimap", "Show the small map of the whole board."),
  [SETTING_IDS.showPalette]: () => switchRow(SETTING_IDS.showPalette, "Show tool palette", "Show the tool palette along the bottom of the board."),
  [SETTING_IDS.motion]: () => selectRow(SETTING_IDS.motion, "Motion", "Full, reduced, or none. A system reduced-motion setting shortens Full.", ["full", "reduced", "none"]),
  [SETTING_IDS.toolbarLayout]: () => selectRow(SETTING_IDS.toolbarLayout, "Toolbar layout", "Split: board bar on top, tools in the dock. Classic: the 2.1 look, tools in the top bar. Dock only: hide the top bar until the pointer is near the top edge.", ["split", "classic", "dock-only"]),
  [SETTING_IDS.dockPosition]: () => selectRow(SETTING_IDS.dockPosition, "Tool dock position", "Where the tool dock sits. A board can override this from its More menu.", ["bottom", "left", "top"]),
  [SETTING_IDS.dockStyle]: () => selectRow(SETTING_IDS.dockStyle, "Dock shape", "Pill is a rounded floating dock. Strip is a flat bar.", ["pill", "strip"]),
  [SETTING_IDS.dockLabels]: () => switchRow(SETTING_IDS.dockLabels, "Show tool names under icons", "Label each tool in the dock."),
  [SETTING_IDS.chromeDensity]: () => selectRow(SETTING_IDS.chromeDensity, "Button size", "Comfortable or compact buttons for both bars.", ["comfortable", "compact"]),
  [SETTING_IDS.dockOptions]: () => switchRow(SETTING_IDS.dockOptions, "Show tool options in the dock", "Show the active tool's quick options (colors, look, shape) next to the dock."),
  [SETTING_IDS.controlsPosition]: () => selectRow(SETTING_IDS.controlsPosition, "Controls", "Rail is the vertical stack on the right. Bar is the horizontal zoom group.", ["rail", "bar"]),
  [SETTING_IDS.snapGuides]: () => switchRow(SETTING_IDS.snapGuides, "Snap guides", "Line a dragged card up with its neighbours and show the guides."),
  [SETTING_IDS.snapGrid]: () => switchRow(SETTING_IDS.snapGrid, "Snap to grid", "Snap a dragged card to the 24 pixel grid. Hold Alt while dragging to skip snapping."),
  [SETTING_IDS.grid]: () => selectRow(SETTING_IDS.grid, "Default board background: pattern", "Pattern for boards that do not set their own. A board can override it from Background.", ["dots", "lines", "grid", "plain"]),
  [SETTING_IDS.boardTone]: () => selectRow(SETTING_IDS.boardTone, "Default board background: tone", "Color wash for boards that do not set their own.", BOARD_TONES),
  [SETTING_IDS.mapZoom]: () => selectRow(SETTING_IDS.mapZoom, "Map view below (zoom)", "Below this zoom, cards show only their title.", MAP_ZOOMS),
  [SETTING_IDS.autoFitSections]: () => switchRow(SETTING_IDS.autoFitSections, "Auto-fit sections", "Grow a section when a card is moved or resized past its edge."),
  [SETTING_IDS.spaceOut]: () => switchRow(SETTING_IDS.spaceOut, "Space out cards", "After a move, push cards apart when they overlap."),
  [SETTING_IDS.showCardBadges]: () => switchRow(SETTING_IDS.showCardBadges, "Show card badges", "Show how many references, tasks, and children a card has."),
  [SETTING_IDS.enterInCard]: () => selectRow(SETTING_IDS.enterInCard, "Enter in a card", "Newline adds a line to the card's block, like a native Roam diagram. Child makes a new child block inside the card.", ["newline", "child"]),
  [SETTING_IDS.defaultCardLook]: () => selectRow(SETTING_IDS.defaultCardLook, "Default card look", "New note cards. Block is a plain Roam block. Card keeps a title row.", ["block", "card"]),
  [SETTING_IDS.defaultCardWidth]: () => inputRow(SETTING_IDS.defaultCardWidth, "Default card width", "Width of a new card, in pixels."),
  [SETTING_IDS.defaultCardHeight]: () => inputRow(SETTING_IDS.defaultCardHeight, "Default card height", "Height of a new card, in pixels."),
  [SETTING_IDS.enableShortcuts]: () => switchRow(SETTING_IDS.enableShortcuts, "Enable shortcuts", "Use keyboard shortcuts on the board."),
  [SETTING_IDS.showVersionBadge]: () => switchRow(SETTING_IDS.showVersionBadge, "Show version badge", "Show the version on the board."),
  [SETTING_IDS.disableOnMobile]: () => switchRow(SETTING_IDS.disableOnMobile, "Disable on mobile", "Do not open diagrams on a phone."),
  [SETTING_IDS.collapseOutline]: () => switchRow(SETTING_IDS.collapseOutline, "Collapse the outline", "Fold an enhanced board once, so the outline does not list every card. Opening the bullet is remembered."),
};

const SETTING_GROUPS = [
  ["group-cards", "Cards", "How new cards look, and the marks on them.", [
    SETTING_IDS.defaultCardLook, SETTING_IDS.defaultCardWidth, SETTING_IDS.defaultCardHeight, SETTING_IDS.enterInCard, SETTING_IDS.showCardBadges, SETTING_IDS.spaceOut,
  ]],
  ["group-sections", "Sections", "How a section grows around its cards.", [
    SETTING_IDS.autoFitSections,
  ]],
  ["group-connections", "Connections", "Lines drawn from page references and attributes.", [
    SETTING_IDS.graphLinks, SETTING_IDS.attrStyles,
  ]],
  ["group-board", "Board", "The canvas, the controls, and how you move around.", [
    SETTING_IDS.enabled, SETTING_IDS.fullscreenOnZoom, SETTING_IDS.wheel, SETTING_IDS.showMinimap, SETTING_IDS.showPalette,
    SETTING_IDS.toolbarLayout, SETTING_IDS.dockPosition, SETTING_IDS.dockStyle, SETTING_IDS.dockLabels, SETTING_IDS.chromeDensity, SETTING_IDS.dockOptions,
    SETTING_IDS.controlsPosition, SETTING_IDS.snapGuides, SETTING_IDS.snapGrid, SETTING_IDS.grid, SETTING_IDS.boardTone,
    SETTING_IDS.mapZoom, SETTING_IDS.enableShortcuts, SETTING_IDS.showVersionBadge,
  ]],
  ["group-performance", "Performance", "Motion, and when the overlay stays off.", [
    SETTING_IDS.motion, SETTING_IDS.disableOnMobile, SETTING_IDS.collapseOutline,
  ]],
];

export function createSettingsPanel() {
  const settings = [];
  for (const [id, name, description, members] of SETTING_GROUPS) {
    settings.push(groupRow(id, name, description));
    for (const member of members) settings.push(SETTING_ROWS[member]());
  }
  settings.push({
    id: "reset-plexus-settings",
    name: "Reset",
    description: "Put every Plexus setting back to its default. Open boards update right away.",
    action: { type: "button", content: "Reset Plexus settings", onClick: () => resetPlexusSettings() },
  });
  return { tabTitle: "Plexus Diagram", settings };
}
