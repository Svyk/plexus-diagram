import assert from "node:assert/strict";
import test from "node:test";

import { attributeRows, boardsFromRows, closeInfoTab, infoTabList, nextPanelWidth, tagNames } from "../src/model/info.js";

test("attributeRows keeps Name:: values and skips everything else", () => {
  assert.deepEqual(attributeRows([
    "Role:: tester",
    "  Alias::  one two  ",
    "[[Alpha]]",
    "Nope",
    "Empty::",
    12,
  ]), [
    { name: "Role", value: "tester" },
    { name: "Alias", value: "one two" },
    { name: "Empty", value: "" },
  ]);
});

test("tagNames reads #tag and #[[Page]] once each", () => {
  assert.deepEqual(tagNames("see #hb1 and #[[Tag Page]] then #hb1 again"), ["hb1", "Tag Page"]);
  assert.deepEqual(tagNames("no hash here"), []);
  assert.deepEqual(tagNames("#[[Only]]"), ["Only"]);
});

test("boardsFromRows drops non-v2 rows, dedupes, and caps", () => {
  const rows = [
    { uid: "a", title: "Fixture", pageTitle: "Lab", v: 2 },
    { uid: "a", title: "Again", pageTitle: "Lab", v: 2 },
    { uid: "n", title: "Native", pageTitle: "Lab", v: 1 },
    { uid: "b", title: "", pageTitle: "", v: 2 },
    { uid: "c", title: "Third", pageTitle: "Notes", v: 2 },
  ];
  assert.deepEqual(boardsFromRows(rows, { limit: 2 }), [
    { uid: "a", title: "Fixture", pageTitle: "Lab" },
    { uid: "b", title: "Untitled board", pageTitle: "" },
  ]);
});

test("info tabs add, switch, and close without keeping a closed card", () => {
  let state = infoTabList([], "a", { add: true });
  state = infoTabList(state.tabs, "b", { add: true });
  state = infoTabList(state.tabs, "c", { add: true });
  assert.deepEqual(state.tabs.map((t) => t.uid), ["a", "b", "c"]);
  state = infoTabList(state.tabs, "a");
  assert.equal(state.current, "a");
  assert.equal(state.tabs.length, 3);
  state = closeInfoTab(state.tabs, "a", "a");
  assert.deepEqual(state.tabs.map((t) => t.uid), ["b", "c"]);
  assert.equal(state.current, "b");
  state = closeInfoTab(state.tabs, "b", "c");
  assert.equal(state.current, "b");
  assert.deepEqual(state.tabs.map((t) => t.uid), ["b"]);
});

test("panel width grows when the left edge moves left and stays in range", () => {
  assert.equal(nextPanelWidth(340, 40), 380);
  assert.equal(nextPanelWidth(340, -1000), 260);
  assert.equal(nextPanelWidth(340, 1000), 640);
  assert.equal(nextPanelWidth("nope", 0), 340);
});
