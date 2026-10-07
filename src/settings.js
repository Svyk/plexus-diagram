import { onGuardCount } from "./guard.js";
import { integrations, statusLine } from "./model/detect.js";
import { bindPerfReadout, perfReadoutText, readHostPerf } from "./perf-log.js";

export const SETTING_IDS = Object.freeze({
  enabled: "enabled",
  autoEnhance: "auto-enhance",
  fullscreenOnZoom: "fullscreen-on-zoom",
  graphLinks: "graph-links",
  attrStyles: "attr-styles",
  wheel: "wheel",
  emptyDrag: "empty-drag",
  showMinimap: "show-minimap",
  controlsPosition: "controls-position",
  snapGuides: "snap-guides",
  snapGrid: "snap-grid",
  grid: "grid",
  // G3. Optional Heptabase looks. Defaults keep today's canvas, sections, and highlight bar.
  lookCanvas: "look-canvas",
  lookSections: "look-sections",
  lookHighlights: "look-highlights",
  theme: "theme",
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
  resurface: "resurface",
  regionsInline: "regions-inline",
  interop: "interop",
  speedLog: "speed-log",
  pdfCover: "pdf-cover",
  pdfCoverWarm: "pdf-cover-warm",
  highlightOpen: "highlight-open",
  pdfDark: "pdf-dark",
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
  [SETTING_IDS.emptyDrag]: "pan",
  [SETTING_IDS.showMinimap]: true,
  [SETTING_IDS.controlsPosition]: "rail",
  [SETTING_IDS.snapGuides]: true,
  [SETTING_IDS.snapGrid]: false,
  [SETTING_IDS.grid]: "dots",
  [SETTING_IDS.lookCanvas]: "dots",
  [SETTING_IDS.lookSections]: "none",
  [SETTING_IDS.lookHighlights]: "bar",
  [SETTING_IDS.theme]: "follow-roam",
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
  [SETTING_IDS.resurface]: true,
  [SETTING_IDS.regionsInline]: true,
  [SETTING_IDS.interop]: true,
  [SETTING_IDS.speedLog]: false,
  [SETTING_IDS.pdfCover]: "first",
  [SETTING_IDS.pdfCoverWarm]: true,
  [SETTING_IDS.highlightOpen]: "reader",
  [SETTING_IDS.pdfDark]: "dim",
});

const BOARD_TONES = ["none", "paper", "gray", "red", "orange", "yellow", "green", "teal", "blue", "indigo", "purple", "pink"];
const MAP_ZOOMS = ["0.3", "0.45", "0.6"];
const TOOLTIP_DELAYS = ["instant", "350 ms", "800 ms"];
const TASK_CHIPS = ["full", "due only", "none"];

const ENUMS = Object.freeze({
  [SETTING_IDS.graphLinks]: ["off", "attributes", "all"],
  [SETTING_IDS.wheel]: ["pan", "zoom"],
  [SETTING_IDS.emptyDrag]: ["pan", "select"],
  [SETTING_IDS.controlsPosition]: ["rail", "bar"],
  [SETTING_IDS.grid]: ["dots", "lines", "grid", "plain"],
  [SETTING_IDS.lookCanvas]: ["dots", "flat-grey"],
  [SETTING_IDS.lookSections]: ["none", "pastel"],
  [SETTING_IDS.lookHighlights]: ["bar", "tint"],
  [SETTING_IDS.theme]: ["follow-roam", "plexus"],
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
  [SETTING_IDS.pdfCover]: ["first", "last-read"],
  [SETTING_IDS.highlightOpen]: ["reader", "sidebar"],
  [SETTING_IDS.pdfDark]: ["off", "dim", "invert"],
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
  if (INTEGRATION_SWITCH_IDS.has(id)) liveSwitches.set(id, normalizeSetting(id, value) === true);
  for (const fn of [...listeners]) {
    try {
      fn(id, value);
    } catch (error) {
      console.error("[plexus-diagram] Settings listener failed", error);
    }
  }
  if (INTEGRATION_SWITCH_IDS.has(id)) refreshIntegrations();
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

const STATUS_IDS = Object.freeze({
  betterTasks: "status-better-tasks",
  taskStatusTags: "status-task-status-tags",
  roamPlexus: "status-roam-plexus",
  compass: "status-compass",
  highlighter: "status-highlighter",
});

const STATUS_FOR = Object.freeze({
  [STATUS_IDS.betterTasks]: "better-tasks",
  [STATUS_IDS.taskStatusTags]: "task-status-tags",
  [STATUS_IDS.roamPlexus]: "roam-plexus",
  [STATUS_IDS.compass]: "compass",
  [STATUS_IDS.highlighter]: "highlighter",
});

const SWITCH_FOR = Object.freeze({
  "better-tasks": SETTING_IDS.betterTasks,
  "roam-plexus": SETTING_IDS.interop,
  compass: SETTING_IDS.interop,
});

const INTEGRATION_SWITCH_IDS = new Set([
  SETTING_IDS.betterTasks,
  SETTING_IDS.taskTool,
  SETTING_IDS.cardChips,
  SETTING_IDS.resurface,
  SETTING_IDS.regionsInline,
  SETTING_IDS.interop,
]);

const integrationText = new Map();
const liveSwitches = new Map();

function integrationHost(win) {
  if (win) return win;
  return globalThis.window ?? globalThis;
}

function switchOn(detectId) {
  const settingId = SWITCH_FOR[detectId];
  if (!settingId) return undefined;
  if (liveSwitches.has(settingId)) return liveSwitches.get(settingId);
  let raw = null;
  try { raw = settingsStore?.settings?.get?.(settingId); } catch { raw = null; }
  if (raw == null || raw === "") return DEFAULTS[settingId] === true;
  return normalizeSetting(settingId, raw) === true;
}

function syncIntegrationText(win) {
  for (const found of integrations(integrationHost(win))) {
    const statusId = Object.keys(STATUS_FOR).find((id) => STATUS_FOR[id] === found.id);
    if (!statusId) continue;
    integrationText.set(statusId, statusLine(found, switchOn(found.id)));
  }
}

function reactOf() {
  const host = globalThis.window ?? globalThis;
  const React = host?.React ?? globalThis.React;
  return React && typeof React.createElement === "function" ? React : null;
}

function integrationStatusComponent(statusId) {
  return function IntegrationStatus() {
    const text = integrationText.get(statusId) || "";
    const React = reactOf();
    if (!React) return text;
    try { return React.createElement("span", { className: "pxd-integration-status" }, text); }
    catch { return text; }
  };
}

function statusSettingRow(statusId, label) {
  return {
    id: statusId,
    name: label,
    description: integrationText.get(statusId) || `${label}: not installed`,
    action: { type: "reactComponent", component: integrationStatusComponent(statusId) },
  };
}

function paintIntegrationRows() {
  const list = panelRef?.settings;
  if (!list) return;
  for (const entry of list) {
    if (!integrationText.has(entry.id)) continue;
    entry.description = integrationText.get(entry.id);
  }
}

// Re-reads detection. feature.js calls this on INTEGRATION_EVENTS (ready/unload).
export function refreshIntegrations(win) {
  syncIntegrationText(win);
  paintIntegrationRows();
}

const SETTING_ROWS = {
  [STATUS_IDS.betterTasks]: () => statusSettingRow(STATUS_IDS.betterTasks, "Better Tasks"),
  [STATUS_IDS.taskStatusTags]: () => statusSettingRow(STATUS_IDS.taskStatusTags, "Task Status Tags"),
  [STATUS_IDS.roamPlexus]: () => statusSettingRow(STATUS_IDS.roamPlexus, "Roam Plexus"),
  [STATUS_IDS.compass]: () => statusSettingRow(STATUS_IDS.compass, "Compass"),
  [STATUS_IDS.highlighter]: () => statusSettingRow(STATUS_IDS.highlighter, "Colour highlighter"),
  [SETTING_IDS.enabled]: () => switchRow(SETTING_IDS.enabled, "Enabled", "Turn the diagram overlay on or off."),
  [SETTING_IDS.autoEnhance]: () => switchRow(SETTING_IDS.autoEnhance, "Every diagram is a Plexus board", "On: every {{[[diagram]]}} opens as a Plexus board. Nothing is saved until you change the board. Off: only diagrams you enhance (Plexus: Enhance) or create with New whiteboard open in Plexus."),
  [SETTING_IDS.fullscreenOnZoom]: () => switchRow(SETTING_IDS.fullscreenOnZoom, "Fullscreen on zoom", "Open a diagram full screen when you zoom into its block. Esc leaves it."),
  [SETTING_IDS.graphLinks]: () => selectRow(SETTING_IDS.graphLinks, "Graph links", "Show lines between cards that share a page reference or an attribute.", ["all", "attributes", "off"]),
  [SETTING_IDS.attrStyles]: () => inputRow(SETTING_IDS.attrStyles, "Attribute styles", "One JSON object. Each attribute name gets a palette color and a line: solid, dashed, or dotted."),
  [SETTING_IDS.wheel]: () => selectRow(SETTING_IDS.wheel, "Mouse wheel", "What the mouse wheel does on the board. Pinch still zooms.", ["pan", "zoom"]),
  [SETTING_IDS.emptyDrag]: () => selectRow(SETTING_IDS.emptyDrag, "Drag on empty canvas", "Pan: dragging empty space moves the board, and Shift-drag draws a selection box. Select: dragging empty space draws the box.", ["pan", "select"]),
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
  [SETTING_IDS.lookCanvas]: () => selectRow(SETTING_IDS.lookCanvas, "Canvas", "Dots keeps the dot grid. Flat grey is a plain canvas, the Heptabase grey, with no grid.", ["dots", "flat-grey"]),
  [SETTING_IDS.lookSections]: () => selectRow(SETTING_IDS.lookSections, "Section fill", "None leaves a section as it is today. Pastel washes it with its colour.", ["none", "pastel"]),
  [SETTING_IDS.lookHighlights]: () => selectRow(SETTING_IDS.lookHighlights, "Highlight cards", "Bar keeps the colour strip. Tint fills the card with the highlight colour and hides the strip.", ["bar", "tint"]),
  [SETTING_IDS.theme]: () => selectRow(SETTING_IDS.theme, "Theme", "Follow Roam uses the colours of the open graph. Plexus keeps the slate board.", ["follow-roam", "plexus"]),
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
  [SETTING_IDS.resurface]: () => switchRow(SETTING_IDS.resurface, "Resurface", "Allow the resurface macro. A daily page can list cards from earlier days, and Plexus Commands can insert the button."),
  [SETTING_IDS.regionsInline]: () => switchRow(SETTING_IDS.regionsInline, "Inline region crops", "Show a region crop beside its button. Off leaves the button and hides the crop."),
  [SETTING_IDS.interop]: () => switchRow(SETTING_IDS.interop, "Roam Plexus and Compass", "Use Roam Plexus and Compass when they are loaded. Off hides Open in Compass and stops thumbnail calls."),
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
  [SETTING_IDS.pdfCover]: () => selectRow(SETTING_IDS.pdfCover, "PDF card cover", "First page shows page 1. Last page read shows the page that was open when the reader closed.", ["first", "last-read"]),
  [SETTING_IDS.pdfCoverWarm]: () => switchRow(SETTING_IDS.pdfCoverWarm, "Prepare PDF covers in the background", "On. A quiet board prepares a cover for a visible PDF that does not have one: Roam's PDF engine draws page 1 when it is reachable, otherwise a hidden reader does."),
  [SETTING_IDS.highlightOpen]: () => selectRow(SETTING_IDS.highlightOpen, "Highlight click opens", "Reader: the PDF pane scrolls to the highlight. Sidebar: Roam opens the highlight block in the right sidebar. Shift-click always opens the sidebar; the chip's arrow lists every choice.", ["reader", "sidebar"]),
  [SETTING_IDS.pdfDark]: () => selectRow(SETTING_IDS.pdfDark, "PDF pages in dark mode", "When the board is dark. Off keeps white pages. Dim darkens the page. Invert flips the page colors. Marks stay readable.", ["off", "dim", "invert"]),
};

const SETTING_GROUPS = [
  ["group-cards", "Cards", "How new cards look, and the marks on them.", [
    SETTING_IDS.defaultCardLook, SETTING_IDS.defaultCardWidth, SETTING_IDS.defaultCardHeight, SETTING_IDS.enterInCard, SETTING_IDS.showCardBadges, SETTING_IDS.spaceOut,
    SETTING_IDS.pdfCover, SETTING_IDS.pdfCoverWarm, SETTING_IDS.highlightOpen, SETTING_IDS.pdfDark,
  ]],
  ["group-integrations", "Integrations", "Sibling extensions, and the switches that turn them on.", [
    STATUS_IDS.betterTasks, SETTING_IDS.betterTasks,
    STATUS_IDS.taskStatusTags,
    SETTING_IDS.taskTool, SETTING_IDS.taskChips, SETTING_IDS.taskDefaultProject,
    STATUS_IDS.roamPlexus, STATUS_IDS.compass, SETTING_IDS.interop,
    STATUS_IDS.highlighter,
    SETTING_IDS.cardChips, SETTING_IDS.resurface, SETTING_IDS.regionsInline,
  ]],
  ["group-sections", "Sections", "How a section grows around its cards.", [
    SETTING_IDS.autoFitSections,
  ]],
  ["group-connections", "Connections", "Lines drawn from page references and attributes.", [
    SETTING_IDS.graphLinks, SETTING_IDS.attrStyles, SETTING_IDS.whyPrompt,
  ]],
  ["group-board", "Board", "The canvas, the controls, and how you move around.", [
    SETTING_IDS.enabled, SETTING_IDS.autoEnhance, SETTING_IDS.fullscreenOnZoom, SETTING_IDS.wheel, SETTING_IDS.emptyDrag, SETTING_IDS.showMinimap, SETTING_IDS.showPalette,
    SETTING_IDS.toolbarLayout, SETTING_IDS.dockPosition, SETTING_IDS.dockStyle, SETTING_IDS.dockLabels, SETTING_IDS.chromeDensity, SETTING_IDS.dockOptions,
    SETTING_IDS.tooltips, SETTING_IDS.tooltipDelay,
    SETTING_IDS.controlsPosition, SETTING_IDS.snapGuides, SETTING_IDS.snapGrid, SETTING_IDS.grid, SETTING_IDS.boardTone,
    SETTING_IDS.lookCanvas, SETTING_IDS.lookSections, SETTING_IDS.lookHighlights, SETTING_IDS.theme,
    SETTING_IDS.mapZoom, SETTING_IDS.enableShortcuts, SETTING_IDS.showVersionBadge, SETTING_IDS.resurfaceIntervals,
  ]],
  ["group-performance", "Performance", "Motion, and when the overlay stays off.", [
    SETTING_IDS.motion, SETTING_IDS.disableOnMobile, SETTING_IDS.collapseOutline, SETTING_IDS.speedLog,
  ]],
];

const ERROR_ROW_ID = "plexus-errors";
let panelRef = null;
let statsRef = null;
let unhookErrors = null;

function errorRow(n) {
  const text = `${n} errors`;
  return {
    id: ERROR_ROW_ID,
    name: text,
    description: "Callback errors since this copy loaded. Nothing is sent.",
    action: { type: "reactComponent", component: () => text },
  };
}

function placeErrorRow() {
  if (!panelRef) return;
  const list = panelRef.settings;
  const idx = list.findIndex((row) => row.id === ERROR_ROW_ID);
  const n = Number(statsRef?.errors) || 0;
  if (n <= 0) {
    if (idx >= 0) list.splice(idx, 1);
    return;
  }
  const row = errorRow(n);
  if (idx >= 0) list[idx] = row;
  else {
    const at = list.findIndex((entry) => entry.id === SETTING_IDS.showVersionBadge);
    list.splice(at >= 0 ? at + 1 : list.length, 0, row);
  }
}

// The installed panel (no stats argument) follows this object. A positive count shows "N errors".
export function bindErrorStats(stats) {
  statsRef = stats && typeof stats === "object" ? stats : null;
  if (!unhookErrors) unhookErrors = onGuardCount(() => placeErrorRow());
  placeErrorRow();
}

export function clearErrorStats() {
  if (unhookErrors) {
    unhookErrors();
    unhookErrors = null;
  }
  statsRef = null;
  placeErrorRow();
}

function performanceGroupRow(id, name, description) {
  const text = () => perfReadoutText(readHostPerf());
  const row = groupRow(id, name, `${description} ${text()}`, text);
  bindPerfReadout(row, description);
  return row;
}

export function createSettingsPanel({ stats } = {}) {
  syncIntegrationText();
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
  const panel = { tabTitle: "Plexus Diagram", settings };
  if (stats && typeof stats === "object") {
    const n = Number(stats.errors) || 0;
    if (n > 0) {
      const at = settings.findIndex((entry) => entry.id === SETTING_IDS.showVersionBadge);
      settings.splice(at >= 0 ? at + 1 : settings.length, 0, errorRow(n));
    }
    return panel;
  }
  panelRef = panel;
  placeErrorRow();
  return panel;
}
