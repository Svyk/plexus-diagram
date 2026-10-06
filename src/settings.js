import { bindPerfReadout, perfReadoutText, readHostPerf } from "./perf-log.js";

export const SETTING_IDS = Object.freeze({
  enabled: "enabled",
  autoEnhance: "auto-enhance",
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
  cardChips: "card-chips",
  whyPrompt: "why-prompt",
  resurfaceIntervals: "resurface-intervals",
  showPalette: "show-palette",
  motion: "motion",
  enterInCard: "enter-in-card",
  toolbarLayout: "toolbar-layout",
  dockPosition: "dock-position",
  dockStyle: "dock-style",
  dockLabels: "dock-labels",
  chromeDensity: "chrome-density",
  dockOptions: "dock-options",
  tooltips: "tooltips",
  tooltipDelay: "tooltip-delay",
  taskTool: "task-tool",
  taskChips: "task-chips",
  taskDefaultProject: "task-default-project",
  betterTasks: "better-tasks",
  speedLog: "speed-log",
  // Hidden. Not a panel row. JSON object, parsed by parseSpeedFlags.
  speedFlags: "speed-flags",
});

const DEFAULTS = Object.freeze({
  [SETTING_IDS.enabled]: true,
  [SETTING_IDS.autoEnhance]: true,
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
  [SETTING_IDS.cardChips]: true,
  [SETTING_IDS.whyPrompt]: false,
  [SETTING_IDS.resurfaceIntervals]: "7,30,90,365",
  [SETTING_IDS.showPalette]: true,
  [SETTING_IDS.motion]: "full",
  [SETTING_IDS.enterInCard]: "newline",
  [SETTING_IDS.toolbarLayout]: "split",
  [SETTING_IDS.dockPosition]: "bottom",
  [SETTING_IDS.dockStyle]: "pill",
  [SETTING_IDS.dockLabels]: false,
  [SETTING_IDS.chromeDensity]: "comfortable",
  [SETTING_IDS.dockOptions]: true,
  [SETTING_IDS.tooltips]: true,
  [SETTING_IDS.tooltipDelay]: "350 ms",
  [SETTING_IDS.taskTool]: false,
  [SETTING_IDS.taskChips]: "full",
  [SETTING_IDS.taskDefaultProject]: "",
  [SETTING_IDS.betterTasks]: false,
  [SETTING_IDS.speedLog]: false,
});

const BOARD_TONES = ["none", "paper", "gray", "red", "orange", "yellow", "green", "teal", "blue", "indigo", "purple", "pink"];
const MAP_ZOOMS = ["0.3", "0.45", "0.6"];
const TOOLTIP_DELAYS = ["instant", "350 ms", "800 ms"];
const TASK_CHIPS = ["full", "due only", "none"];

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
  [SETTING_IDS.tooltipDelay]: TOOLTIP_DELAYS,
  [SETTING_IDS.taskChips]: TASK_CHIPS,
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

// FAST-9. All six on. A missing key stays on. JSON that does not parse leaves this.
const SPEED_FLAG_NAMES = ["posters", "parking", "keepAlive", "prefetch", "sketch", "budgetedMount"];

export function defaultSpeedFlags() {
  return { posters: true, parking: true, keepAlive: true, prefetch: true, sketch: true, budgetedMount: true };
}

export function parseSpeedFlags(raw) {
  const base = defaultSpeedFlags();
  if (raw == null || raw === "") return base;
  let obj = raw;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return base;
    try { obj = JSON.parse(text); } catch { return base; }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return base;
  const out = { ...base };
  for (const name of SPEED_FLAG_NAMES) {
    if (!Object.prototype.hasOwnProperty.call(obj, name)) continue;
    const value = obj[name];
    if (value === false || value === "false") out[name] = false;
    else if (value === true || value === "true") out[name] = true;
  }
  return out;
}

let notedFlags = defaultSpeedFlags();
let speedSource = null;

export function noteSpeedFlags(raw) {
  notedFlags = parseSpeedFlags(raw);
  return notedFlags;
}

// Cards and the feature gates read through this. A bound getter sees a hidden
// setting change on the next read. Null, "", and bad JSON are all six on.
// A throw keeps the last snapshot.
export function notedSpeedFlags() {
  if (typeof speedSource === "function") {
    try { return noteSpeedFlags(speedSource()); }
    catch { /* the snapshot stands */ }
  }
  return notedFlags;
}

export function bindSpeedFlagSource(get) {
  speedSource = typeof get === "function" ? get : null;
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
  let speedRaw = null;
  try { speedRaw = extensionAPI?.settings?.get?.(SETTING_IDS.speedFlags); } catch { speedRaw = null; }
  out[SETTING_IDS.speedFlags] = noteSpeedFlags(speedRaw);
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

function groupRow(id, name, description, component) {
  return {
    id,
    name,
    description,
    action: { type: "reactComponent", component: typeof component === "function" ? component : () => null },
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
  [SETTING_IDS.autoEnhance]: () => switchRow(SETTING_IDS.autoEnhance, "Every diagram is a Plexus board", "On: every {{[[diagram]]}} opens as a Plexus board. Nothing is saved until you change the board. Off: only diagrams you enhance (Plexus: Enhance) or create with New whiteboard open in Plexus."),
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
  [SETTING_IDS.tooltips]: () => switchRow(SETTING_IDS.tooltips, "Hover tooltips", "Show a name, shortcut and one-line description when you hover or focus a control. Off falls back to the browser's plain tooltip."),
  [SETTING_IDS.tooltipDelay]: () => selectRow(SETTING_IDS.tooltipDelay, "Tooltip delay", "How long to hover before a tooltip shows. Keyboard focus always shows it at once.", TOOLTIP_DELAYS),
  [SETTING_IDS.controlsPosition]: () => selectRow(SETTING_IDS.controlsPosition, "Controls", "Rail is the vertical stack on the right. Bar is the horizontal zoom group.", ["rail", "bar"]),
  [SETTING_IDS.snapGuides]: () => switchRow(SETTING_IDS.snapGuides, "Snap guides", "Line a dragged card up with its neighbours and show the guides."),
  [SETTING_IDS.snapGrid]: () => switchRow(SETTING_IDS.snapGrid, "Snap to grid", "Snap a dragged card to the 24 pixel grid. Hold Alt while dragging to skip snapping."),
  [SETTING_IDS.grid]: () => selectRow(SETTING_IDS.grid, "Default board background: pattern", "Pattern for boards that do not set their own. A board can override it from Background.", ["dots", "lines", "grid", "plain"]),
  [SETTING_IDS.boardTone]: () => selectRow(SETTING_IDS.boardTone, "Default board background: tone", "Color wash for boards that do not set their own.", BOARD_TONES),
  [SETTING_IDS.mapZoom]: () => selectRow(SETTING_IDS.mapZoom, "Map view below (zoom)", "Below this zoom, cards show only their title.", MAP_ZOOMS),
  [SETTING_IDS.autoFitSections]: () => switchRow(SETTING_IDS.autoFitSections, "Auto-fit sections", "Grow a section when a card is moved or resized past its edge."),
  [SETTING_IDS.spaceOut]: () => switchRow(SETTING_IDS.spaceOut, "Space out cards", "After a move, push cards apart when they overlap."),
  [SETTING_IDS.showCardBadges]: () => switchRow(SETTING_IDS.showCardBadges, "Show card badges", "Show how many references, tasks, and children a card has."),
  [SETTING_IDS.cardChips]: () => switchRow(SETTING_IDS.cardChips, "Board chips", "Show a board chip under a block that is a card on a board."),
  [SETTING_IDS.whyPrompt]: () => switchRow(SETTING_IDS.whyPrompt, "Ask why on a new connection", "After you draw a connection, open the why field."),
  [SETTING_IDS.resurfaceIntervals]: () => inputRow(SETTING_IDS.resurfaceIntervals, "Resurface intervals", "Days, separated by commas. A daily page lists cards from those many days ago."),
  [SETTING_IDS.betterTasks]: () => switchRow(SETTING_IDS.betterTasks, "Better Tasks integration", "Use Better Tasks for task chips, the light checkbox, and task edits. Off leaves the TODO marker to Roam."),
  [SETTING_IDS.taskTool]: () => switchRow(SETTING_IDS.taskTool, "Task tool", "Show the Task tool (K) in the dock. It makes a Roam TODO block; Better Tasks sets its due date and project."),
  [SETTING_IDS.taskChips]: () => selectRow(SETTING_IDS.taskChips, "Task chips", "What a task card shows under its title. Full: due date, project, priority, repeat, status. Due only: just the date. None: no chips.", TASK_CHIPS),
  [SETTING_IDS.taskDefaultProject]: () => inputRow(SETTING_IDS.taskDefaultProject, "Default project for new tasks", "A page name. A task made from the board gets it as its Better Tasks project. Empty uses Better Tasks' own default."),
  [SETTING_IDS.enterInCard]: () => selectRow(SETTING_IDS.enterInCard, "Enter in a card", "Newline adds a line to the card's block, like a native Roam diagram. Child makes a new child block inside the card.", ["newline", "child"]),
  [SETTING_IDS.defaultCardLook]: () => selectRow(SETTING_IDS.defaultCardLook, "Default card look", "New note cards. Block is a plain Roam block. Card keeps a title row.", ["block", "card"]),
  [SETTING_IDS.defaultCardWidth]: () => inputRow(SETTING_IDS.defaultCardWidth, "Default card width", "Width of a new card, in pixels."),
  [SETTING_IDS.defaultCardHeight]: () => inputRow(SETTING_IDS.defaultCardHeight, "Default card height", "Height of a new card, in pixels."),
  [SETTING_IDS.enableShortcuts]: () => switchRow(SETTING_IDS.enableShortcuts, "Enable shortcuts", "Use keyboard shortcuts on the board."),
  [SETTING_IDS.showVersionBadge]: () => switchRow(SETTING_IDS.showVersionBadge, "Show version badge", "Show the version on the board."),
  [SETTING_IDS.disableOnMobile]: () => switchRow(SETTING_IDS.disableOnMobile, "Disable on mobile", "Do not open diagrams on a phone."),
  [SETTING_IDS.collapseOutline]: () => switchRow(SETTING_IDS.collapseOutline, "Collapse the outline", "Fold an enhanced board once, so the outline does not list every card. Opening the bullet is remembered."),
  [SETTING_IDS.speedLog]: () => switchRow(SETTING_IDS.speedLog, "Speed log", "Record open time, click-to-paint, pan frame rate, and long tasks in this tab. Nothing is sent or saved."),
};

const SETTING_GROUPS = [
  ["group-cards", "Cards", "How new cards look, and the marks on them.", [
    SETTING_IDS.defaultCardLook, SETTING_IDS.defaultCardWidth, SETTING_IDS.defaultCardHeight, SETTING_IDS.enterInCard, SETTING_IDS.showCardBadges, SETTING_IDS.cardChips, SETTING_IDS.spaceOut,
  ]],
  ["group-integrations", "Integrations", "Better Tasks, the task tool, and what a task card shows.", [
    SETTING_IDS.betterTasks, SETTING_IDS.taskTool, SETTING_IDS.taskChips, SETTING_IDS.taskDefaultProject,
  ]],
  ["group-sections", "Sections", "How a section grows around its cards.", [
    SETTING_IDS.autoFitSections,
  ]],
  ["group-connections", "Connections", "Lines drawn from page references and attributes.", [
    SETTING_IDS.graphLinks, SETTING_IDS.attrStyles, SETTING_IDS.whyPrompt,
  ]],
  ["group-board", "Board", "The canvas, the controls, and how you move around.", [
    SETTING_IDS.enabled, SETTING_IDS.autoEnhance, SETTING_IDS.fullscreenOnZoom, SETTING_IDS.wheel, SETTING_IDS.showMinimap, SETTING_IDS.showPalette,
    SETTING_IDS.toolbarLayout, SETTING_IDS.dockPosition, SETTING_IDS.dockStyle, SETTING_IDS.dockLabels, SETTING_IDS.chromeDensity, SETTING_IDS.dockOptions,
    SETTING_IDS.tooltips, SETTING_IDS.tooltipDelay,
    SETTING_IDS.controlsPosition, SETTING_IDS.snapGuides, SETTING_IDS.snapGrid, SETTING_IDS.grid, SETTING_IDS.boardTone,
    SETTING_IDS.mapZoom, SETTING_IDS.enableShortcuts, SETTING_IDS.showVersionBadge, SETTING_IDS.resurfaceIntervals,
  ]],
  ["group-performance", "Performance", "Motion, and when the overlay stays off.", [
    SETTING_IDS.motion, SETTING_IDS.disableOnMobile, SETTING_IDS.collapseOutline, SETTING_IDS.speedLog,
  ]],
];

function performanceGroupRow(id, name, description) {
  const text = () => perfReadoutText(readHostPerf());
  const row = groupRow(id, name, `${description} ${text()}`, text);
  bindPerfReadout(row, description);
  return row;
}

export function createSettingsPanel() {
  const settings = [];
  for (const [id, name, description, members] of SETTING_GROUPS) {
    settings.push(id === "group-performance" ? performanceGroupRow(id, name, description) : groupRow(id, name, description));
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
