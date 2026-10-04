// TSK-1. New task leaves the canvas menu only when taskTool is false. Make task stays.
import assert from "node:assert/strict";
import test from "node:test";

import { buildMenu, flattenMenu } from "../src/view/menu-model.js";

const ids = (items) => items.filter((item) => !item.separator).map((item) => item.id);
const flat = (items) => flattenMenu(items).map((item) => item.id);

test("buildMenu omits new-task only when taskTool is false", () => {
  assert.equal(ids(buildMenu("canvas", { taskTool: false })).includes("new-task"), false);
  assert.equal(ids(buildMenu("canvas", {})).includes("new-task"), true);
  assert.equal(ids(buildMenu("canvas", { taskTool: true })).includes("new-task"), true);
  const off = ids(buildMenu("canvas", { taskTool: false }));
  assert.ok(off.indexOf("new-card") >= 0 && off.indexOf("new-card") < off.indexOf("new-text"));
});

test("make-task stays on the card menu when canMakeTask is true", () => {
  assert.equal(flat(buildMenu("card", { canMakeTask: true })).includes("make-task"), true);
  assert.equal(flat(buildMenu("card", { canMakeTask: true, taskTool: false })).includes("make-task"), true);
});
