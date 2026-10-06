// Feature detection for sibling extensions. Pure reads of a window-like object.
// Better Tasks and the colour highlighter do not fire ready/unload. The others do.

export const INTEGRATION_EVENTS = Object.freeze([
  "roam-compass:ready",
  "roam-compass:unload",
  "roam-plexus:ready",
  "roam-plexus:unload",
  "roam-task-status-tags:ready",
  "roam-task-status-tags:unload",
]);

// Same names cards.js probes on document.body for --cl-lh-* / --cl-dk-*.
const HL_NAMES = ["red", "orange", "yellow", "green", "blue", "purple", "pink", "gray", "grey", "teal", "indigo"];

const MISSING = "not installed";
const FOUND = "detected";

function read(win, key) {
  try { return win?.[key]; } catch { return undefined; }
}

function plainVersion(value) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return "";
}

function apiVersionText(api) {
  if (!api || typeof api !== "object") return "";
  const text = plainVersion(api.apiVersion);
  return text ? `apiVersion ${text}` : "";
}

function row(id, label, state, version) {
  return { id, label, state, version: version || "" };
}

function missing(id, label) {
  return row(id, label, MISSING, "");
}

export function betterTasks(win) {
  let entry = null;
  try { entry = win?.RoamExtensionTools?.["better-tasks"]; } catch { entry = null; }
  const bt = read(win, "betterTasks");
  const entryOn = entry != null && typeof entry === "object";
  const btOn = bt != null && typeof bt === "object";
  if (!entryOn && !btOn) return missing("better-tasks", "Better Tasks");
  const version = plainVersion(entry?.version)
    || plainVersion(bt?.version)
    || plainVersion(bt?.v1?.version)
    || plainVersion(bt?.v2?.version);
  return row("better-tasks", "Better Tasks", FOUND, version);
}

export function taskStatusTags(win) {
  const api = read(win, "RoamTaskStatusTags");
  if (!api || typeof api !== "object") return missing("task-status-tags", "Task Status Tags");
  return row("task-status-tags", "Task Status Tags", FOUND, apiVersionText(api));
}

export function roamPlexus(win) {
  const api = read(win, "RoamPlexus");
  if (!api || typeof api !== "object") return missing("roam-plexus", "Roam Plexus");
  return row("roam-plexus", "Roam Plexus", FOUND, apiVersionText(api));
}

export function compass(win) {
  const api = read(win, "RoamCompass");
  const flag = plainVersion(read(win, "__ROAM_COMPASS_VERSION"));
  const apiOn = api != null && typeof api === "object";
  if (!apiOn && !flag) return missing("compass", "Compass");
  return row("compass", "Compass", FOUND, flag || apiVersionText(api));
}

function styleText(doc) {
  let text = "";
  try {
    const nodes = typeof doc.querySelectorAll === "function" ? doc.querySelectorAll("style") : [];
    for (const node of nodes || []) text += String(node?.textContent || "");
  } catch { /* a hostile document stays undetected */ }
  const sheets = doc?.styleSheets;
  if (!sheets) return text;
  for (const sheet of sheets) {
    try {
      const rules = sheet?.cssRules || sheet?.rules;
      if (!rules) continue;
      for (const rule of rules) text += String(rule?.cssText || "");
    } catch { /* cross-origin sheet */ }
  }
  return text;
}

function highlighterVars(win) {
  const doc = win?.document;
  const view = doc?.defaultView || win;
  const body = doc?.body;
  if (!body || typeof view?.getComputedStyle !== "function") return false;
  let style = null;
  try { style = view.getComputedStyle(body); } catch { return false; }
  if (!style || typeof style.getPropertyValue !== "function") return false;
  for (const name of HL_NAMES) {
    let light = "";
    let dark = "";
    try {
      light = style.getPropertyValue(`--cl-lh-${name}`);
      dark = style.getPropertyValue(`--cl-dk-${name}`);
    } catch { return false; }
    if ((typeof light === "string" && light.trim()) || (typeof dark === "string" && dark.trim())) return true;
  }
  return false;
}

function highlighterMarker(win) {
  const doc = win?.document;
  if (!doc) return false;
  try {
    if (typeof doc.querySelector === "function" && doc.querySelector('[id*="roam-extension-color-highlighter"]')) return true;
  } catch { /* keep looking */ }
  const text = styleText(doc);
  return text.includes('[data-tag^=".bg-"]') || text.includes("--cl-lh-");
}

function highlighterGlobal(win) {
  for (const key of ["RoamColorHighlighter", "colorHighlighter"]) {
    const value = read(win, key);
    if (value && typeof value === "object") return value;
  }
  return null;
}

// The published colour highlighter has no JS API. Detection is its stylesheet
// (--cl-lh-* / --cl-dk-* on body, or a [data-tag^=".bg-"] rule). A global is
// accepted when a build exposes RoamColorHighlighter or colorHighlighter.
export function highlighter(win) {
  const global = highlighterGlobal(win);
  let marked = false;
  try { marked = highlighterVars(win) || highlighterMarker(win); } catch { marked = false; }
  if (!global && !marked) return missing("highlighter", "Colour highlighter");
  return row("highlighter", "Colour highlighter", FOUND, plainVersion(global?.version));
}

export function integrations(win) {
  return [betterTasks(win), taskStatusTags(win), roamPlexus(win), compass(win), highlighter(win)];
}

// "Better Tasks: detected 1.3 · off". switchOn omitted leaves the switch off the line.
export function statusLine(row, switchOn) {
  const label = String(row?.label || "Integration");
  const detected = row?.state === FOUND;
  const version = detected ? plainVersion(row?.version) : "";
  let line = detected ? `${label}: detected${version ? ` ${version}` : ""}` : `${label}: ${MISSING}`;
  if (switchOn === true) line += " · on";
  else if (switchOn === false) line += " · off";
  return line;
}
