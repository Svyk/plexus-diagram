// One shortcut table. The sheet renders it, and the key handler matches it.
// A new key belongs in this list or it is not a shortcut.

const down = (ev) => String(ev.key || "").toLowerCase();
const hasMod = (ev) => Boolean(ev.meta || ev.ctrl);
const letter = (ev, ch) => !hasMod(ev) && !ev.alt && down(ev) === ch;

function arrow(ev, { alt, shift }) {
  return !hasMod(ev) && Boolean(ev.alt) === alt && Boolean(ev.shift) === shift && String(ev.key || "").startsWith("Arrow");
}

function removeKey(ev, shift) {
  return !hasMod(ev) && !ev.alt && Boolean(ev.shift) === shift && (ev.key === "Delete" || ev.key === "Backspace");
}

const ARROWS = [{ key: "ArrowLeft" }, { key: "ArrowRight" }, { key: "ArrowUp" }, { key: "ArrowDown" }];
const ARROWS_SHIFT = ARROWS.map((ev) => ({ ...ev, shift: true }));
const ARROWS_ALT = ARROWS.map((ev) => ({ ...ev, alt: true }));
const ARROWS_BOTH = ARROWS.map((ev) => ({ ...ev, alt: true, shift: true }));

export const SHORTCUTS = [
  { group: "Tools", keys: "V", label: "Select", action: "tool", tool: "select", letter: "v", events: [{ key: "v" }], match: (ev) => letter(ev, "v") },
  { group: "Tools", keys: "H", label: "Hand", action: "tool", tool: "hand", letter: "h", events: [{ key: "h" }], match: (ev) => letter(ev, "h") },
  { group: "Tools", keys: "N", label: "Card", action: "tool", tool: "card", letter: "n", events: [{ key: "n" }], match: (ev) => letter(ev, "n") },
  { group: "Tools", keys: "K", label: "Task", action: "tool", tool: "task", letter: "k", events: [{ key: "k" }], match: (ev) => letter(ev, "k"), when: (settings) => (settings && typeof settings.get === "function" ? settings.get("task-tool") : settings?.["task-tool"]) === true },
  { group: "Tools", keys: "T", label: "Text", action: "tool", tool: "text", letter: "t", events: [{ key: "t" }], match: (ev) => letter(ev, "t") },
  { group: "Tools", keys: "S", label: "Sticky", action: "tool", tool: "sticky", letter: "s", events: [{ key: "s" }], match: (ev) => letter(ev, "s") },
  { group: "Tools", keys: "R", label: "Shape", action: "tool", tool: "shape", letter: "r", events: [{ key: "r" }], match: (ev) => letter(ev, "r") },
  { group: "Tools", keys: "G", label: "Section", action: "tool", tool: "section", letter: "g", events: [{ key: "g" }], match: (ev) => letter(ev, "g") },
  { group: "Tools", keys: "W", label: "Board", action: "tool", tool: "board", letter: "w", events: [{ key: "w" }], match: (ev) => letter(ev, "w") },
  { group: "Tools", keys: "C", label: "Connect", action: "tool", tool: "connect", letter: "c", events: [{ key: "c" }], match: (ev) => letter(ev, "c") },

  { group: "Edit", keys: "Enter", label: "Edit, open, or rename", action: "enter", events: [{ key: "Enter" }], match: (ev) => !hasMod(ev) && !ev.alt && !ev.shift && ev.key === "Enter" },
  { group: "Edit", keys: "F2", label: "Rename page", action: "renamePage", events: [{ key: "F2" }], match: (ev) => !hasMod(ev) && !ev.alt && ev.key === "F2" },
  { group: "Edit", keys: "⌘D", label: "Duplicate", action: "duplicate", events: [{ key: "d", meta: true }], match: (ev) => hasMod(ev) && !ev.alt && down(ev) === "d" },
  { group: "Edit", keys: "Delete", label: "Delete", action: "delete", events: [{ key: "Delete" }, { key: "Backspace" }], match: (ev) => removeKey(ev, false) },
  { group: "Edit", keys: "Shift+Delete", label: "Delete with contents", action: "delete", events: [{ key: "Delete", shift: true }, { key: "Backspace", shift: true }], match: (ev) => removeKey(ev, true) },
  { group: "Edit", keys: "⌘Z", label: "Undo", action: "undo", events: [{ key: "z", meta: true }], match: (ev) => hasMod(ev) && !ev.alt && !ev.shift && down(ev) === "z" },
  { group: "Edit", keys: "⌘⇧Z", label: "Redo", action: "redo", events: [{ key: "z", meta: true, shift: true }], match: (ev) => hasMod(ev) && !ev.alt && ev.shift && down(ev) === "z" },
  { group: "Edit", keys: "⌘⌥Enter", label: "Fold selection", action: "fold", events: [{ key: "Enter", meta: true, alt: true }], match: (ev) => hasMod(ev) && ev.alt && down(ev) === "enter" },
  { group: "Edit", keys: "⌘G", label: "Wrap in a section", action: "wrap", events: [{ key: "g", meta: true }], match: (ev) => hasMod(ev) && !ev.alt && down(ev) === "g" },

  { group: "Select", keys: "⌘A", label: "Select all", action: "selectAll", events: [{ key: "a", meta: true }], match: (ev) => hasMod(ev) && !ev.alt && down(ev) === "a" },
  { group: "Select", keys: "Tab", label: "Next in outline", action: "outline", events: [{ key: "Tab" }], match: (ev) => ev.key === "Tab" && !ev.alt && !ev.shift && !hasMod(ev) },
  { group: "Select", keys: "Shift+Tab", label: "Previous in outline", action: "outline", events: [{ key: "Tab", shift: true }], match: (ev) => ev.key === "Tab" && !ev.alt && ev.shift && !hasMod(ev) },
  { group: "Select", keys: "⌥+arrows", label: "Select nearest", action: "nearest", events: ARROWS_ALT, match: (ev) => arrow(ev, { alt: true, shift: false }) },
  { group: "Select", keys: "Shift+⌥+arrows", label: "Add nearest", action: "nearest", events: ARROWS_BOTH, match: (ev) => arrow(ev, { alt: true, shift: true }) },
  { group: "Select", keys: "Shift+F10", label: "Card menu", action: "cardMenu", mode: "view", events: [{ key: "F10", shift: true }, { key: "ContextMenu" }], match: (ev) => !hasMod(ev) && !ev.alt && (ev.key === "ContextMenu" || (ev.shift && ev.key === "F10")) },
  { group: "Select", keys: "M", label: "Expand outline", action: "expand", events: [{ key: "m" }], match: (ev) => letter(ev, "m") },

  { group: "View", keys: "Space", label: "Hold to pan", action: "space", mode: "always", events: [{ key: " ", code: "Space" }], match: (ev) => ev.code === "Space" || ev.key === " " },
  { group: "View", keys: "⌘+", label: "Zoom in", action: "zoomIn", events: [{ key: "=", meta: true }, { key: "+", meta: true }], match: (ev) => hasMod(ev) && !ev.alt && (ev.key === "=" || ev.key === "+") },
  { group: "View", keys: "⌘-", label: "Zoom out", action: "zoomOut", events: [{ key: "-", meta: true }, { key: "_", meta: true }], match: (ev) => hasMod(ev) && !ev.alt && (ev.key === "-" || ev.key === "_") },
  { group: "View", keys: "⇧0", label: "Zoom to 100%", action: "zoomReset", events: [{ key: ")", code: "Digit0", shift: true }], match: (ev) => !hasMod(ev) && !ev.alt && ev.shift && (ev.code === "Digit0" || ev.key === ")") },
  { group: "View", keys: "⇧1", label: "Fit all", action: "fitAll", events: [{ key: "!", code: "Digit1", shift: true }], match: (ev) => !hasMod(ev) && !ev.alt && ev.shift && (ev.code === "Digit1" || ev.key === "!") },
  { group: "View", keys: "⇧2", label: "Fit selection", action: "fitSelection", events: [{ key: "@", code: "Digit2", shift: true }], match: (ev) => !hasMod(ev) && !ev.alt && ev.shift && (ev.code === "Digit2" || ev.key === "@") },
  { group: "View", keys: "Arrows", label: "Nudge", action: "nudge", events: ARROWS, match: (ev) => arrow(ev, { alt: false, shift: false }) },
  { group: "View", keys: "Shift+arrows", label: "Nudge by 10", action: "nudge", events: ARROWS_SHIFT, match: (ev) => arrow(ev, { alt: false, shift: true }) },
  { group: "View", keys: "L", label: "Cycle links", action: "links", events: [{ key: "l" }], match: (ev) => letter(ev, "l") },
  { group: "View", keys: "/ or ⌘F", label: "Find on board", action: "search", events: [{ key: "/" }, { key: "f", meta: true }], match: (ev) => !ev.alt && ((ev.key === "/" && !hasMod(ev)) || (hasMod(ev) && down(ev) === "f")) },
  { group: "View", keys: "I", label: "Info", action: "info", events: [{ key: "i" }, { key: "I" }], match: (ev) => letter(ev, "i") },
  { group: "View", keys: "F", label: "Focus", action: "focus", events: [{ key: "f" }], match: (ev) => letter(ev, "f") },
  { group: "View", keys: "Q", label: "Quick Look", action: "quickLook", events: [{ key: "q" }], match: (ev) => letter(ev, "q") },
  { group: "View", keys: "P", label: "Present", action: "present", events: [{ key: "p" }], match: (ev) => letter(ev, "p") },
  { group: "View", keys: "?", label: "Shortcuts", action: "help", events: [{ key: "?", shift: true, code: "Slash" }], match: (ev) => !hasMod(ev) && !ev.alt && (ev.key === "?" || (ev.code === "Slash" && ev.shift)) },
  { group: "View", keys: "Escape", label: "Close or step back", action: "escape", mode: "always", events: [{ key: "Escape" }], match: (ev) => ev.key === "Escape" },

  { group: "Navigate", keys: "⌘[", label: "Back", action: "back", events: [{ key: "[", meta: true, code: "BracketLeft" }], match: (ev) => hasMod(ev) && !ev.shift && !ev.alt && (ev.code === "BracketLeft" || ev.key === "[") },
  { group: "Navigate", keys: "⌘]", label: "Forward", action: "forward", events: [{ key: "]", meta: true, code: "BracketRight" }], match: (ev) => hasMod(ev) && !ev.shift && !ev.alt && (ev.code === "BracketRight" || ev.key === "]") },

  { group: "Present", keys: "→ ↓ Space", label: "Next", action: "presentNext", mode: "present", events: [{ key: "ArrowRight" }, { key: "ArrowDown" }, { key: "PageDown" }, { key: " ", code: "Space" }], match: (ev) => !hasMod(ev) && !ev.alt && (ev.key === "ArrowRight" || ev.key === "ArrowDown" || ev.key === "PageDown" || ev.code === "Space" || ev.key === " ") },
  { group: "Present", keys: "← ↑", label: "Previous", action: "presentPrev", mode: "present", events: [{ key: "ArrowLeft" }, { key: "ArrowUp" }, { key: "PageUp" }], match: (ev) => !hasMod(ev) && !ev.alt && (ev.key === "ArrowLeft" || ev.key === "ArrowUp" || ev.key === "PageUp") },
];

// A missing settings argument does not apply when. A row is skipped only when when is a function and returns false.
export function findShortcut(ev, mode = "normal", settings) {
  return SHORTCUTS.find((row) => {
    if ((row.mode || "normal") !== mode || !row.match(ev)) return false;
    if (settings == null || typeof row.when !== "function") return true;
    return row.when(settings) !== false;
  }) || null;
}
