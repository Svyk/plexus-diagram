import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_MIND_PRESET,
  MIND_GAPS,
  MIND_PRESET_KEY,
  branchColor,
  normalizeMindPreset,
  readMindPreset,
  writeMindPreset,
} from "../src/model/mindmap.js";
import { PALETTE } from "../src/model/schema.js";

function memoryStorage(seed = {}) {
  const data = { ...seed };
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    data,
  };
}

test("normalizeMindPreset fills the pre-preset defaults and drops unknown values", () => {
  assert.deepEqual(normalizeMindPreset(null), { ...DEFAULT_MIND_PRESET });
  assert.deepEqual(normalizeMindPreset({}), { ...DEFAULT_MIND_PRESET });
  assert.deepEqual(normalizeMindPreset({ direction: "spin", spacing: "huge", depth: 9, includeRefs: false, colorBranches: true }), {
    direction: "right",
    spacing: "normal",
    depth: 3,
    includeRefs: false,
    colorBranches: true,
  });
  assert.equal(normalizeMindPreset({ direction: "radial", spacing: "compact", depth: 1 }).direction, "radial");
  assert.equal(normalizeMindPreset({ depth: 4 }).depth, 4);
  assert.deepEqual(MIND_GAPS.normal, { hGap: 80, vGap: 24 });
  assert.ok(MIND_GAPS.compact.hGap < MIND_GAPS.normal.hGap && MIND_GAPS.normal.hGap < MIND_GAPS.airy.hGap);
});

test("the mind-map preset is remembered in local storage and merged", () => {
  const storage = memoryStorage();
  assert.deepEqual(readMindPreset(storage), { ...DEFAULT_MIND_PRESET });
  const saved = writeMindPreset(storage, { direction: "down", depth: 4 });
  assert.deepEqual(saved, { direction: "down", spacing: "normal", depth: 4, includeRefs: true, colorBranches: false });
  assert.equal(storage.data[MIND_PRESET_KEY], JSON.stringify(saved));
  assert.deepEqual(readMindPreset(storage), saved);
  const next = writeMindPreset(storage, { spacing: "airy", includeRefs: false, colorBranches: true });
  assert.equal(next.direction, "down", "a later change keeps the direction already stored");
  assert.equal(next.spacing, "airy");
  assert.equal(next.includeRefs, false);
  assert.equal(next.colorBranches, true);
  assert.deepEqual(readMindPreset(memoryStorage({ [MIND_PRESET_KEY]: "{" })), { ...DEFAULT_MIND_PRESET });
  assert.equal(branchColor(0), PALETTE[0]);
  assert.equal(branchColor(PALETTE.length), PALETTE[0]);
});
