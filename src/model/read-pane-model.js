// Pane chrome math. Which toolbar button a pill may press, and when fit-width may run.
// The unnamed Roam button (no icon class and no label) is never a target.

export const PILL_SELECTORS = Object.freeze({
  zoomOut: Object.freeze({ icon: "bp3-icon-zoom-out", label: "Zoom out" }),
  zoomIn: Object.freeze({ icon: "bp3-icon-zoom-in", label: "Zoom in" }),
  fit: Object.freeze({ icon: "bp3-icon-zoom-to-fit", label: "Fit" }),
  search: Object.freeze({ icon: "bp3-icon-search", label: "Search" }),
});

// Highlight, colour, paging, fullscreen and the unnamed control stay Roam's.
const BLOCKED_ICONS = new Set([
  "bp3-icon-highlight",
  "bp3-icon-widget",
  "bp3-icon-eye-open",
  "bp3-icon-chevron-left",
  "bp3-icon-chevron-right",
  "bp3-icon-fullscreen",
  "bp3-icon-more",
]);

function tokensOf(node) {
  const out = [];
  const push = (value) => {
    String(value || "").split(/\s+/).forEach((token) => {
      if (token) out.push(token);
    });
  };
  push(node?.className);
  const kids = typeof node?.querySelectorAll === "function" ? node.querySelectorAll("*") : [];
  for (const kid of kids) push(kid.className);
  return out;
}

// Blueprint chrome classes are not an identity. The unnamed toolbar button has only these.
const PLAIN = new Set(["bp3-button", "bp3-minimal", "bp3-small", "bp3-icon"]);

function blocked(button) {
  if (!button || typeof button !== "object") return true;
  if (button.classList?.contains?.("rm-pdf-color-button")) return true;
  const tokens = tokensOf(button);
  if (tokens.some((name) => BLOCKED_ICONS.has(name))) return true;
  const aria = button.getAttribute?.("aria-label") || "";
  const title = button.getAttribute?.("title") || "";
  const named = tokens.some((name) => name.startsWith("bp3-icon-") || (name && !PLAIN.has(name) && !name.startsWith("bp3-")));
  // Live toolbar index 7 is an svg with no icon class and no label. Never bind it.
  if (!named && !aria && !title) return true;
  return false;
}

function matches(button, spec) {
  if (!spec || typeof spec !== "object") return false;
  const tokens = tokensOf(button);
  if (spec.icon && tokens.includes(spec.icon)) return true;
  const label = typeof spec.label === "string" ? spec.label : "";
  if (!label) return false;
  const aria = button.getAttribute?.("aria-label") || "";
  const title = button.getAttribute?.("title") || "";
  return aria === label || title === label;
}

export function pageIndicator(inputValue, siblingText) {
  const pageText = String(inputValue ?? "").trim();
  const pageMatch = /^(\d+)$/.exec(pageText);
  const pageNum = pageMatch ? Number(pageMatch[1]) : NaN;
  const side = String(siblingText ?? "");
  const totalMatch = /\/\s*(\d+)/.exec(side);
  const totalNum = totalMatch ? Number(totalMatch[1]) : NaN;
  return {
    page: Number.isInteger(pageNum) && pageNum >= 1 ? pageNum : null,
    total: Number.isInteger(totalNum) && totalNum >= 1 ? totalNum : null,
  };
}

// Roam's total is a short span, "/ 9", beside the page field. The field is often
// wrapped, so the span is not always the input's next sibling. Ignore longer
// toolbar text that merely contains a slash.
export function pageTotalText(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  for (const value of list) {
    const text = String(value ?? "").replace(/\u00a0/g, " ").trim();
    if (!text || text.length > 16) continue;
    if (/^\/\s*\d+$/.test(text)) return text;
  }
  return "";
}

export function pillActions(toolbarButtons, selectors = PILL_SELECTORS) {
  const buttons = Array.isArray(toolbarButtons) ? toolbarButtons : [];
  const table = selectors && typeof selectors === "object" ? selectors : PILL_SELECTORS;
  const out = { zoomOut: null, zoomIn: null, fit: null, search: null };
  for (const key of Object.keys(out)) {
    const spec = table[key];
    if (!spec) continue;
    for (const button of buttons) {
      if (blocked(button)) continue;
      if (!matches(button, spec)) continue;
      out[key] = button;
      break;
    }
  }
  return out;
}

// One automatic fit after the first page is on screen. A user zoom cancels it.
export function fitDecision({ userZoomed, hasFit, settled } = {}) {
  return userZoomed !== true && hasFit === true && settled === true;
}
