// HEP-4: source chip for a highlight dragged from Articles/ or Media Captures/.
// The author is read, never written. Roam enters edit on mousedown, so that event stops on the chip.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildSourceChip, sourceChipFor, sourceChipKey } from "../src/model/source-chip.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const PAGE = "pg-articles";

function chip(overrides = {}) {
  return sourceChipFor({
    pageTitle: "Articles/Example",
    pageUid: PAGE,
    pageChildren: ["Author:: [[Ada Lovelace]]"],
    ...overrides,
  });
}

test("Articles with an Author:: child shows the title and the author, brackets stripped", () => {
  const got = chip();
  assert.deepEqual(got, {
    title: "Articles/Example",
    author: "Ada Lovelace",
    pageUid: PAGE,
    text: "Articles/Example · Ada Lovelace",
  });
  assert.equal("props" in got, false);
});

test("an Author:: child object and a bare name both count, and a later attribute does not win", () => {
  const fromPull = sourceChipFor({
    pageTitle: "Articles/Example",
    pageUid: PAGE,
    pageChildren: [
      { ":block/string": "Tags:: #read" },
      { string: "Author:: Grace Hopper" },
      { ":block/string": "Author:: Not This" },
    ],
  });
  assert.equal(fromPull.author, "Grace Hopper");
  assert.equal(fromPull.text, "Articles/Example · Grace Hopper");
});

test("Articles with no author child is the title only", () => {
  const got = chip({ pageChildren: ["Highlights go here", { ":block/string": "Source:: somewhere" }] });
  assert.equal(got.author, "");
  assert.equal(got.text, "Articles/Example");
  assert.equal(got.title, "Articles/Example");
});

test("an empty Author:: is skipped and the chip stays the title", () => {
  const got = chip({ pageChildren: ["Author::   ", "Author:: [[]]"] });
  assert.equal(got.author, "");
  assert.equal(got.text, "Articles/Example");
});

test("Media Captures uses the same chip", () => {
  const got = sourceChipFor({
    pageTitle: "Media Captures/Talk",
    pageUid: "pg-media",
    pageChildren: ["Author:: [[Alan Kay]]"],
  });
  assert.equal(got.title, "Media Captures/Talk");
  assert.equal(got.author, "Alan Kay");
  assert.equal(got.pageUid, "pg-media");
  assert.equal(got.text, "Media Captures/Talk · Alan Kay");
});

test("a block from any other page gets no chip", () => {
  assert.equal(sourceChipFor({
    pageTitle: "Plexus Diagram/Test Lab",
    pageUid: "lab",
    pageChildren: ["Author:: Ada"],
  }), null);
  assert.equal(sourceChipFor({ pageTitle: "Articles", pageUid: "x", pageChildren: ["Author:: Ada"] }), null);
  assert.equal(sourceChipFor({ pageTitle: "articles/Example", pageUid: "x", pageChildren: [] }), null);
  assert.equal(sourceChipFor({ pageTitle: "", pageUid: PAGE, pageChildren: ["Author:: Ada"] }), null);
  assert.equal(sourceChipFor(), null);
});

test("renaming the author changes the content key", () => {
  const before = chip({ pageChildren: ["Author:: Ada"] });
  const after = chip({ pageChildren: ["Author:: Grace"] });
  const same = chip({ pageChildren: [{ ":block/string": "Author:: Ada" }] });
  assert.equal(sourceChipKey(before), sourceChipKey(same));
  assert.notEqual(sourceChipKey(before), sourceChipKey(after));
  assert.equal(sourceChipKey(null), "");
  assert.equal(sourceChipKey(sourceChipFor({ pageTitle: "Daily", pageUid: "d", pageChildren: [] })), "");
});

test("the module never writes props", () => {
  const src = readFileSync(new URL("../src/model/source-chip.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /updateBlock|createBlock|deleteBlock|:block\/props|data\.write/);
});

function mount(pageChildren) {
  const stub = createDomStub();
  const restore = stub.install();
  const parent = stub.document.createElement("div");
  stub.document.body.append(parent);
  const opened = [];
  const button = buildSourceChip(stub.document, chip({ pageChildren }), {
    onOpen(uid) { opened.push(uid); },
  });
  parent.append(button);
  return { stub, restore, parent, button, opened };
}

test("the chip is a source button and click calls onOpen once", () => {
  const { restore, stub, button, opened } = mount(["Author:: [[Ada Lovelace]]"]);
  try {
    assert.equal(button.tagName, "BUTTON");
    assert.equal(button.className, "pxd-chip pxd-chip--source");
    assert.equal(button.type, "button");
    assert.equal(button.getAttribute("aria-label"), "Open Articles/Example · Ada Lovelace");
    assert.equal(button.textContent, "Articles/Example · Ada Lovelace");
    stub.dispatch(button, "click");
    assert.deepEqual(opened, [PAGE]);
  } finally {
    restore();
  }
});

test("Enter calls onOpen once and other keys do not", () => {
  const { restore, stub, button, opened } = mount(["Author:: Ada"]);
  try {
    const enter = stub.dispatch(button, "keydown", { key: "Enter" });
    assert.equal(enter.defaultPrevented, true);
    assert.equal(enter.propagationStopped, true);
    stub.dispatch(button, "keydown", { key: " " });
    stub.dispatch(button, "keydown", { key: "a" });
    assert.deepEqual(opened, [PAGE]);
  } finally {
    restore();
  }
});

test("pointerdown and mousedown stop before the card, the way Roam's edit-on-mousedown works", () => {
  const { restore, stub, parent, button, opened } = mount(["Author:: Ada"]);
  try {
    let reached = 0;
    parent.addEventListener("pointerdown", () => { reached += 1; });
    parent.addEventListener("mousedown", () => { reached += 1; });
    for (const type of ["pointerdown", "mousedown"]) {
      const event = stub.dispatch(button, type);
      assert.equal(event.propagationStopped, true, type);
    }
    assert.equal(reached, 0);
    assert.deepEqual(opened, []);
  } finally {
    restore();
  }
});

test("source chip keeps a 1px border and a clear fill, including dark themes", () => {
  const css = readFileSync(new URL("../src/css/source-chip.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks = [...css.matchAll(/([^{]+)\{([^}]+)\}/g)].map((match) => ({
    selectors: match[1].split(",").map((part) => part.trim()),
    body: match[2],
  }));
  const need = [
    ".pxd-chip.pxd-chip--source",
    ".bp3-dark .pxd-chip.pxd-chip--source",
    "body.bt-theme-dark .pxd-chip.pxd-chip--source",
    ".pxd-root--dark .pxd-chip.pxd-chip--source",
  ];
  for (const selector of need) {
    const block = blocks.find((entry) => entry.selectors.includes(selector));
    assert.ok(block, selector);
    assert.match(block.body, /border:\s*1px solid/);
    assert.match(block.body, /background:\s*transparent/);
  }
  const fills = [...css.matchAll(/background(?:-color)?:\s*([^;]+);/g)].map((match) => match[1].trim());
  assert.ok(fills.length >= 2);
  assert.deepEqual([...new Set(fills)], ["transparent"]);
});

test("HEP-4: authorBlockUid finds the Author:: child and chipWithAuthor follows a rename", async () => {
  const { authorBlockUid, chipWithAuthor, sourceChipFor } = await import("../src/model/source-chip.js");
  const kids = [
    { ":block/uid": "h1", ":block/string": "A highlight" },
    { ":block/uid": "au", ":block/string": "Author:: [[Pat Example]]" },
  ];
  assert.equal(authorBlockUid(kids), "au");
  assert.equal(authorBlockUid([{ ":block/uid": "h1", ":block/string": "No author" }]), "");
  const chip = sourceChipFor({ pageTitle: "Articles/X", pageUid: "pg", pageChildren: kids });
  assert.equal(chip.text, "Articles/X · Pat Example");
  assert.equal(chipWithAuthor(chip, "Author:: [[Sam Renamed]]").text, "Articles/X · Sam Renamed");
  assert.equal(chipWithAuthor(chip, "renamed to plain text").text, "Articles/X");
  assert.equal(chipWithAuthor(chip, "Author:: [[Sam Renamed]]").pageUid, "pg");
});
