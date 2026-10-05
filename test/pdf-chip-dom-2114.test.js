// PDF-7: page chips show the page and a count badge. Click pulses. Double-click opens and cancels.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { paintPdfChipStrip } from "../src/view/pdf-chip-strip.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const CHIPS = [
  { page: 2, count: 1, uids: ["p2"] },
  { page: 3, count: 2, uids: ["p3a", "p3b"] },
];

function pageText(button) {
  const badge = button.querySelector(".pxd-pdf-chip__n");
  let page = "";
  for (const node of button.childNodes) {
    if (node === badge) continue;
    page += node.textContent || "";
  }
  return page.trim();
}

function mount() {
  const stub = createDomStub();
  const restore = stub.install();
  const parent = stub.document.createElement("div");
  stub.document.body.append(parent);
  const pulses = [];
  const opened = [];
  const later = [];
  const strip = paintPdfChipStrip(stub.document, parent, CHIPS, {
    later(fn, ms) { later.push({ fn, ms }); },
    onPulse(uids) { pulses.push(uids); },
    onOpen(page) { opened.push(page); },
  });
  const buttons = [...strip.querySelectorAll("button.pxd-pdf-chip")];
  return { stub, restore, parent, strip, buttons, pulses, opened, later };
}

test("two chips read 2 and 3, badges 1 and 2", () => {
  const { restore, parent, strip, buttons, stub } = mount();
  try {
    assert.equal(parent.lastChild, strip);
    assert.equal(strip.className, "pxd-pdf-chips pxd-chrome");
    assert.equal(buttons.length, 2);
    assert.deepEqual(buttons.map(pageText), ["2", "3"]);
    assert.deepEqual(buttons.map((button) => button.querySelector(".pxd-pdf-chip__n").textContent), ["1", "2"]);
    for (const button of buttons) {
      assert.equal(button.className, "pxd-pdf-chip pxd-chrome");
      assert.equal(button.type, "button");
      assert.equal(button.getAttribute("type"), "button");
    }
    for (const type of ["pointerdown", "mousedown", "dblclick"]) {
      const event = stub.dispatch(buttons[1], type);
      assert.equal(event.propagationStopped, true, type);
    }
  } finally {
    restore();
  }
});

test("a click then the later fn pulses the page-3 uids", () => {
  const { restore, stub, buttons, pulses, later } = mount();
  try {
    stub.dispatch(buttons[1], "click");
    assert.equal(later.length, 1);
    assert.equal(later[0].ms, 280);
    later[0].fn();
    assert.deepEqual(pulses, [["p3a", "p3b"]]);
  } finally {
    restore();
  }
});

test("a double-click opens page 3 and the later fn does not pulse", () => {
  const { restore, stub, buttons, pulses, opened, later } = mount();
  try {
    stub.dispatch(buttons[1], "click");
    stub.dispatch(buttons[1], "dblclick");
    assert.deepEqual(opened, [3]);
    assert.equal(later.length, 1);
    assert.equal(later[0].ms, 280);
    later[0].fn();
    assert.deepEqual(pulses, []);
  } finally {
    restore();
  }
});

test("pdf and board chips keep a 1px border and a clear fill, including dark themes", () => {
  const css = readFileSync(new URL("../src/css/pdf-chips.css", import.meta.url), "utf8");
  const blocks = [...css.matchAll(/([^{]+)\{([^}]+)\}/g)].map((match) => ({
    selectors: match[1].split(",").map((part) => part.trim()),
    body: match[2],
  }));
  const need = [
    ".pxd-pdf-chip.pxd-pdf-chip",
    ".pxd-boardchip.pxd-boardchip",
    ".bp3-dark .pxd-pdf-chip.pxd-pdf-chip",
    ".bp3-dark .pxd-boardchip.pxd-boardchip",
    "body.bt-theme-dark .pxd-pdf-chip.pxd-pdf-chip",
    "body.bt-theme-dark .pxd-boardchip.pxd-boardchip",
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
