// Mind-map preset: direction, spacing, depth, block refs, and branch color.
// The last choice is per device (localStorage). It is not a Roam setting and not a board write.
import { PALETTE } from "./schema.js";

export const MIND_DIRECTIONS = Object.freeze(["right", "down", "balanced", "radial"]);
export const MIND_SPACINGS = Object.freeze(["compact", "normal", "airy"]);
export const MIND_DEPTH_MIN = 1;
export const MIND_DEPTH_MAX = 4;
export const MIND_PRESET_KEY = "plexus-diagram:mindmap-preset";

// normal matches the gaps mindMapLayout used before presets existed.
export const MIND_GAPS = Object.freeze({
  compact: Object.freeze({ hGap: 40, vGap: 12 }),
  normal: Object.freeze({ hGap: 80, vGap: 24 }),
  airy: Object.freeze({ hGap: 140, vGap: 48 }),
});

export const DEFAULT_MIND_PRESET = Object.freeze({
  direction: "right",
  spacing: "normal",
  depth: 3,
  includeRefs: true,
  colorBranches: false,
});

export function normalizeMindPreset(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const depth = Number(src.depth);
  return {
    direction: MIND_DIRECTIONS.includes(src.direction) ? src.direction : DEFAULT_MIND_PRESET.direction,
    spacing: MIND_SPACINGS.includes(src.spacing) ? src.spacing : DEFAULT_MIND_PRESET.spacing,
    depth: Number.isInteger(depth) && depth >= MIND_DEPTH_MIN && depth <= MIND_DEPTH_MAX
      ? depth
      : DEFAULT_MIND_PRESET.depth,
    includeRefs: src.includeRefs === false ? false : DEFAULT_MIND_PRESET.includeRefs,
    colorBranches: src.colorBranches === true,
  };
}

export function readMindPreset(storage) {
  try {
    const raw = storage?.getItem?.(MIND_PRESET_KEY);
    if (!raw) return normalizeMindPreset(null);
    return normalizeMindPreset(JSON.parse(raw));
  } catch {
    return normalizeMindPreset(null);
  }
}

// Merges a partial choice onto the stored preset and writes the result. Returns the stored preset.
export function writeMindPreset(storage, patch) {
  const next = normalizeMindPreset({ ...readMindPreset(storage), ...(patch && typeof patch === "object" ? patch : {}) });
  try { storage?.setItem?.(MIND_PRESET_KEY, JSON.stringify(next)); } catch { /* private mode / quota */ }
  return next;
}

export function branchColor(index) {
  const i = Number.isInteger(index) && index >= 0 ? index : 0;
  return PALETTE[i % PALETTE.length];
}
