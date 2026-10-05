// PDF-1: Interact clicks stay on the reader. Escape ends Interact, or leaves native fullscreen alone.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { pdfClickShield, pdfEscapeAction } from "../src/view/board-view.js";

function element(className, parent = null) {
  const names = String(className || "").split(/\s+/).filter(Boolean);
  const node = {
    parent,
    classList: {
      contains(name) { return names.includes(name); },
    },
    closest(selector) {
      const want = String(selector || "").replace(/^\./, "");
      let cur = node;
      while (cur) {
        if (cur.classList.contains(want)) return cur;
        cur = cur.parent;
      }
      return null;
    },
  };
  return node;
}

test("pdfClickShield is true when closest finds .pxd-pdf-live", () => {
  const card = element("pxd-item pxd-pdf-live");
  const page = element("rm-pdf-container", card);
  const button = element("rm-pdf-nav", page);
  const other = element("pxd-item");
  const chrome = element("pxd-toolbar pxd-chrome", other);
  assert.equal(pdfClickShield(button), true);
  assert.equal(pdfClickShield(page), true);
  assert.equal(pdfClickShield(card), true);
  assert.equal(pdfClickShield(other), false);
  assert.equal(pdfClickShield(chrome), false);
  assert.equal(pdfClickShield(element("pxd-pdf")), false);
  assert.equal(pdfClickShield(null), false);
  assert.equal(pdfClickShield(undefined), false);
  assert.equal(pdfClickShield({}), false);
  const seen = [];
  assert.equal(pdfClickShield({ closest(sel) { seen.push(sel); return null; } }), false);
  assert.deepEqual(seen, [".pxd-pdf-live"]);
  assert.equal(pdfClickShield({ closest() { return card; } }), true);
});

test("pdfEscapeAction returns native for fullscreen, end-interact for a live reader, otherwise pass", () => {
  assert.equal(pdfEscapeAction({ live: true, fullscreen: true }), "native");
  assert.equal(pdfEscapeAction({ live: false, fullscreen: true }), "native");
  assert.equal(pdfEscapeAction({ fullscreen: true }), "native");
  assert.equal(pdfEscapeAction({ live: true, fullscreen: false }), "end-interact");
  assert.equal(pdfEscapeAction({ live: true }), "end-interact");
  assert.equal(pdfEscapeAction({ live: false, fullscreen: false }), "pass");
  assert.equal(pdfEscapeAction({}), "pass");
  assert.equal(pdfEscapeAction(), "pass");
});

test("the root pointerdown handler uses pdfClickShield", () => {
  const src = readFileSync(new URL("../src/view/board-view.js", import.meta.url), "utf8");
  const start = src.indexOf('listen(root, "pointerdown"');
  assert.ok(start >= 0);
  const end = src.indexOf("\n  listen(", start + 1);
  assert.ok(end > start);
  const body = src.slice(start, end);
  const shield = body.indexOf("pdfClickShield(event.target)");
  assert.ok(shield >= 0, "pdfClickShield is used in the pointerdown handler");
  assert.ok(body.indexOf("event.preventDefault") > shield);
  assert.ok(body.indexOf("event.stopPropagation") > shield);
  assert.match(body, /endPdfInteract\(\)/);
});
