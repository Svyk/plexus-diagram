import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { fillFromTags, highlighterTags, rewriteBgTag } from "../src/model/highlighter.js";
import { buildColorPicker } from "../src/view/color-picker.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const MAP = {
  red: "#fcb8b8",
  orange: "#ffecd0",
  yellow: "#fff6b9",
  green: "#d3f8d5",
  blue: "#cee9ff",
  purple: "#e5d4fc",
  pink: "#ffd0ea",
  gray: "#dddddd",
  grey: "#dddddd",
  teal: "#39cccc",
};

test("highlighterTags reads bg and text forms, and the first of each wins", () => {
  assert.deepEqual(highlighterTags("#bg-ch-blue text"), { bg: "blue", text: null });
  assert.deepEqual(highlighterTags("see #[[bg-blue]]"), { bg: "blue", text: null });
  assert.deepEqual(highlighterTags("[[bg-blue]]"), { bg: "blue", text: null });
  assert.deepEqual(highlighterTags("[[bg-ch-teal]]"), { bg: "teal", text: null });
  assert.deepEqual(highlighterTags("#[[bg-ch-blue]]"), { bg: "blue", text: null });
  assert.deepEqual(highlighterTags("#bg-blue"), { bg: "blue", text: null });
  assert.deepEqual(highlighterTags("#c:red **hot**"), { bg: null, text: "red" });
  assert.deepEqual(highlighterTags("#[[c:red]]"), { bg: null, text: "red" });
  assert.deepEqual(highlighterTags("#bg-red #bg-blue"), { bg: "red", text: null });
  assert.deepEqual(highlighterTags("#c:yellow #[[c:red]] #bg-ch-green #bg-blue"), { bg: "green", text: "yellow" });
  assert.deepEqual(highlighterTags("#c:red [[bg-ch-pink]] #bg-blue"), { bg: "pink", text: "red" });
  assert.deepEqual(highlighterTags(""), { bg: null, text: null });
  assert.deepEqual(highlighterTags(null), { bg: null, text: null });
});

test("fillFromTags uses a non-empty probe, else the fixed map, else nothing", () => {
  let asked = null;
  assert.equal(fillFromTags("#bg-ch-blue", (name) => { asked = name; return "#010203"; }), "#010203");
  assert.equal(asked, "blue");
  assert.equal(fillFromTags("#[[bg-blue]]", () => ""), MAP.blue);
  assert.equal(fillFromTags("#bg-red #bg-blue", () => "  "), MAP.red);
  assert.equal(fillFromTags({ bg: "grey" }, () => ""), fillFromTags({ bg: "gray" }, () => ""));
  assert.equal(fillFromTags({ bg: "grey" }, () => ""), MAP.grey);
  for (const [name, hex] of Object.entries(MAP)) {
    assert.equal(fillFromTags({ bg: name }, () => ""), hex, name);
  }
  assert.equal(fillFromTags("#bg-fuchsia", () => ""), "");
  assert.equal(fillFromTags("#c:red **hot**", () => "#ffffff"), "");
  assert.equal(fillFromTags({ bg: "blue" }, (key) => (key === "--cl-lh-blue" ? "#112233" : "")), "#112233");
  assert.equal(fillFromTags({ bg: "blue" }, (key) => (key === "--cl-dk-blue" ? "#0254a0" : "")), "#0254a0");
  assert.equal(fillFromTags({ bg: "blue" }, (key) => (key === "blue" ? "#111111" : "#222222")), "#111111");

  const propsFill = "#112233";
  const fromTag = fillFromTags(highlighterTags("#bg-blue"), () => "");
  const chosen = propsFill || fromTag;
  assert.equal(chosen, propsFill);
  assert.equal(fromTag, MAP.blue);
  assert.equal(fillFromTags.length, 2);
});

test("rewriteBgTag replaces the first bg token with one #[[bg-name]] and does not append another", () => {
  assert.equal(rewriteBgTag("hello #bg-blue", "green"), "hello #[[bg-green]]");
  assert.equal(rewriteBgTag("hello #bg-ch-blue", "green"), "hello #[[bg-green]]");
  assert.equal(rewriteBgTag("#[[bg-blue]] tail", "green"), "#[[bg-green]] tail");
  assert.equal(rewriteBgTag("[[bg-ch-red]] tail", "green"), "#[[bg-green]] tail");
  assert.equal(rewriteBgTag("[[bg-blue]]", "green"), "#[[bg-green]]");
  assert.equal(rewriteBgTag("hello", "green"), "hello #[[bg-green]]");
  assert.equal(rewriteBgTag("", "green"), "#[[bg-green]]");
  assert.equal(rewriteBgTag("hello ", "green"), "hello #[[bg-green]]");
  assert.equal(rewriteBgTag("see #bg-red and #bg-blue please", "green"), "see #[[bg-green]] and please");
  assert.equal(rewriteBgTag("a #c:red #bg-blue", "green"), "a #c:red #[[bg-green]]");
  assert.equal(rewriteBgTag("a #c:red", "green"), "a #c:red #[[bg-green]]");
  assert.equal(rewriteBgTag("hello #bg-blue", null), "hello");
  assert.equal(rewriteBgTag("#bg-ch-red keep", null), "keep");
  assert.equal(rewriteBgTag("#bg-red #bg-blue", null), "#bg-blue");
  assert.equal(rewriteBgTag("a #c:red #bg-blue", null), "a #c:red");
  assert.equal(rewriteBgTag("a #c:red", null), "a #c:red");
  assert.equal(rewriteBgTag("a #bg-red", "green blue"), "a #bg-red");
  assert.equal((rewriteBgTag("x #bg-red", "green").match(/#\[\[bg-/g) || []).length, 1);
  assert.equal(rewriteBgTag("x #bg-red", "green").includes("#bg-green"), false);
});

function rowButtons(box, label) {
  const cap = [...box.querySelectorAll(".pxd-picker__cap")].find((node) => node.textContent === label);
  return [...cap.parentElement.querySelectorAll(".pxd-picker__swatch")];
}

test("buildColorPicker keeps onPick when onTag is omitted", () => {
  const { document } = createDomStub();
  const picks = [];
  const box = buildColorPicker(document, (color) => picks.push(color));
  assert.equal(box.querySelector(".pxd-picker__gear"), null);
  assert.equal(box.querySelector(".pxd-picker__tag-note"), null);
  const green = rowButtons(box, "Named").find((node) => node.getAttribute("data-color") === "green");
  green.click();
  assert.deepEqual(picks, ["green"]);
});

test("tag mode calls onTag only from a named swatch click, and the gear only calls onGear", () => {
  const { document } = createDomStub();
  const picks = [];
  const tags = [];
  const gear = [];
  const box = buildColorPicker(document, (color) => picks.push(color), null, {
    onTag: (name) => tags.push(name),
    onGear: (on) => gear.push(on),
    tagMode: true,
  });
  assert.deepEqual(picks, []);
  assert.deepEqual(tags, []);
  assert.deepEqual(gear, []);

  const gearBtn = box.querySelector(".pxd-picker__gear");
  assert.equal(gearBtn.textContent, "Write as highlighter tag");
  assert.equal(gearBtn.getAttribute("aria-label"), "Write as highlighter tag");
  assert.equal(gearBtn.getAttribute("aria-pressed"), "true");
  assert.equal(gearBtn.classList.contains("pxd-picker__gear--on"), true);
  const note = box.querySelector(".pxd-picker__tag-note");
  assert.equal(note.textContent, "Hex, darker, and lighter stay on the card only.");
  assert.equal(note.hasAttribute("hidden"), false);

  rowButtons(box, "Named").find((node) => node.getAttribute("data-color") === "green").click();
  assert.deepEqual(tags, ["green"]);
  assert.deepEqual(picks, []);

  const colors = rowButtons(box, "Colors")[0];
  colors.click();
  const darker = rowButtons(box, "Darker")[1];
  darker.click();
  const lighter = rowButtons(box, "Lighter")[0];
  lighter.click();
  assert.deepEqual(picks, [colors.getAttribute("data-color"), darker.getAttribute("data-color"), lighter.getAttribute("data-color")]);
  assert.deepEqual(tags, ["green"]);

  const input = box.querySelector(".pxd-picker__input");
  input.value = "#112233";
  input.dispatchEvent({ type: "change" });
  input.value = "#abcdef";
  input.dispatchEvent({ type: "keydown", key: "Enter" });
  box.querySelector(".pxd-picker__clear").click();
  assert.deepEqual(picks, [colors.getAttribute("data-color"), darker.getAttribute("data-color"), lighter.getAttribute("data-color"), "#112233", "#abcdef", null]);
  assert.deepEqual(tags, ["green"]);
  assert.deepEqual(gear, []);

  gearBtn.click();
  assert.deepEqual(gear, [false]);
  assert.equal(gearBtn.getAttribute("aria-pressed"), "false");
  assert.equal(note.hasAttribute("hidden"), true);
  assert.deepEqual(tags, ["green"]);
  rowButtons(box, "Named").find((node) => node.getAttribute("data-color") === "red").click();
  assert.deepEqual(picks.at(-1), "red");
  assert.deepEqual(tags, ["green"]);

  gearBtn.click();
  assert.deepEqual(gear, [false, true]);
  assert.equal(note.hasAttribute("hidden"), false);
  rowButtons(box, "Named").find((node) => node.getAttribute("data-color") === "teal").click();
  assert.deepEqual(tags, ["green", "teal"]);
});

test("opening a tag-off picker does not call onTag or onGear, and options may be the third argument", () => {
  const { document } = createDomStub();
  const tags = [];
  const gear = [];
  const picks = [];
  const box = buildColorPicker(document, (color) => picks.push(color), {
    onTag: (name) => tags.push(name),
    onGear: (on) => gear.push(on),
  });
  assert.equal(box.querySelector(".pxd-picker__gear").getAttribute("aria-pressed"), "false");
  assert.equal(box.querySelector(".pxd-picker__tag-note").hasAttribute("hidden"), true);
  assert.deepEqual(tags, []);
  assert.deepEqual(gear, []);
  rowButtons(box, "Named").find((node) => node.getAttribute("data-color") === "blue").click();
  assert.deepEqual(picks, ["blue"]);
  assert.deepEqual(tags, []);
  box.querySelector(".pxd-picker__gear").click();
  assert.deepEqual(gear, [true]);
  assert.deepEqual(tags, []);
  rowButtons(box, "Named").find((node) => node.getAttribute("data-color") === "blue").click();
  assert.deepEqual(tags, ["blue"]);
  assert.deepEqual(picks, ["blue"]);
});

test("highlighter.css scopes tag hiding under .pxd-root.pxd-hl and sets no color on page refs or strong", () => {
  const css = readFileSync(new URL("../src/css/highlighter.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) blocks.push({ sel: match[1], body: match[2] });
  assert.ok(blocks.length >= 2);
  for (const block of blocks) {
    assert.match(block.sel, /\.pxd-root/);
    if (/\.rm-page-ref|\bstrong\b/.test(block.sel)) assert.doesNotMatch(block.body, /(^|[^-])color\s*:/);
  }
  assert.equal(blocks.some((block) => /\bstrong\b/.test(block.sel)), false);
  const hide = blocks.filter((block) => /data-tag/.test(block.sel));
  assert.equal(hide.length, 1);
  assert.match(hide[0].sel, /\.pxd-root\.pxd-hl/);
  assert.match(hide[0].sel, /span\.rm-page-ref\[data-tag\^="bg-"\]/);
  assert.match(hide[0].sel, /a\.rm-page-ref\[data-tag\^="bg-"\]/);
  assert.match(hide[0].sel, /span\.rm-page-ref\[data-tag\^="c:"\]/);
  assert.match(hide[0].sel, /a\.rm-page-ref\[data-tag\^="c:"\]/);
  assert.match(hide[0].body, /display:\s*none/);
  assert.doesNotMatch(hide[0].body, /(^|[^-])color\s*:/);
});
