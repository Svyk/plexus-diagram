// P5-A. Writes on the board root re-run every rule that reads it over the whole board (Chrome does not compare the
// old value), so the theme writes only what changed.
import assert from "node:assert/strict";
import test from "node:test";

import { applyThemeVars } from "../src/model/theme-colors.js";

const styleStub = () => {
  const props = new Map();
  const writes = [];
  return {
    writes,
    setProperty(k, v) { writes.push(["set", k]); props.set(k, v); },
    removeProperty(k) { writes.push(["remove", k]); props.delete(k); },
    getPropertyValue(k) { return props.get(k) ?? ""; },
  };
};

test("applying the same theme twice writes nothing the second time", () => {
  const style = styleStub();
  const vars = { "--pxd-surface": "rgb(32, 43, 51)", "--pxd-text": "rgb(225, 232, 237)" };
  applyThemeVars(style, vars);
  const first = style.writes.length;
  assert.ok(first >= 2);
  applyThemeVars(style, { ...vars });
  assert.equal(style.writes.length, first, "no write for unchanged values");
  applyThemeVars(style, { ...vars, "--pxd-text": "rgb(0, 0, 0)" });
  assert.deepEqual(style.writes.slice(first), [["set", "--pxd-text"]]);
});
