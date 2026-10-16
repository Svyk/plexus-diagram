// Lane C fix round. A word-sized pin lands on the parsed part that contains it.
// A sidebar jump waits for the pin's own PDF.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

import { matchParsedBlock, pageFracFromBbox } from "../src/model/pdf-pin.js";
import { jumpSidebarPdf, pdfTargetsMatch, waitForSidebarPdf, watchNodeGone } from "../src/view/pin-reveal.js";
import { createDomStub } from "./fixtures/dom-stub.js";

function figureDoc() {
  const page = { n: 3, w: 100, h: 200, rotation: 0 };
  const figure = { id: "f1", type: "figure", page: 3, bbox: [10, 20, 60, 80] };
  const text = { id: "p1", type: "para", page: 3, bbox: [10, 90, 90, 120], text: "Osmotic water flow" };
  const section = { id: "s1", type: "section", page: 3, bbox: [0, 70, 100, 150] };
  const table = { id: "t1", type: "table", page: 3, bbox: [10, 130, 90, 180] };
  return {
    page,
    figure,
    text,
    doc: { blocks: { f1: figure, s1: section, p1: text, t1: table }, order: ["s1", "f1", "p1", "t1"], pages: [page] },
  };
}

test("a word-sized hit matches the tightest block that holds its centre", () => {
  const { doc, page, text } = figureDoc();
  const para = pageFracFromBbox(text.bbox, page);
  const word = [para[0] + 0.2, para[1] + 0.04, 0.08, 0.03];
  assert.equal(matchParsedBlock(doc, { page: 3, frac: word }).id, "p1");
  assert.equal(matchParsedBlock(doc, { page: 3, frac: [0.01, 0.01, 0.04, 0.02] }), null);
  const speck = [0.2, 0.2, 0.05, 0.04];
  assert.equal(matchParsedBlock(doc, { page: 3, frac: speck }).id, "f1");
});

test("a similar box still wins on IoU, and a mostly covered smaller block still matches", () => {
  const { doc, page, text } = figureDoc();
  const para = pageFracFromBbox(text.bbox, page);
  const formula = { id: "q0", type: "formula", page: 3, bbox: [46, 100, 54, 110] };
  const nested = {
    ...doc,
    blocks: { ...doc.blocks, q0: formula },
    order: [...doc.order, "q0"],
  };
  const near = [para[0] + 0.02, para[1] + 0.01, para[2] - 0.04, para[3] - 0.02];
  assert.equal(matchParsedBlock(nested, { page: 3, frac: near }).id, "p1");
  const small = { id: "q1", type: "formula", page: 4, bbox: [30, 30, 42, 42] };
  const page4 = { n: 4, w: 100, h: 100, rotation: 0 };
  const quiet = {
    blocks: { ...doc.blocks, q1: small, corner: { id: "corner", type: "para", page: 4, bbox: [2, 2, 8, 8] } },
    order: [...doc.order, "q1", "corner"],
    pages: [...doc.pages, page4],
  };
  // Hit is larger than the formula, covers most of it, and its centre sits outside the formula.
  assert.equal(matchParsedBlock(quiet, { page: 4, frac: [0.18, 0.30, 0.20, 0.12] }).id, "q1");
  assert.equal(matchParsedBlock(quiet, { page: 4, frac: [0, 0, 1, 1] }), null);
});

function sidebarWindow(doc, uid, page, url) {
  const win = doc.createElement("div");
  win.className = "rm-sidebar-window";
  win.id = uid ? `sidebar-window-sidebar-block-${uid}` : "sidebar-window-notes";
  const box = doc.createElement("div");
  box.className = "rm-pdf-container";
  if (url) box.setAttribute("data-pdf-url", url);
  const input = doc.createElement("input");
  input.value = page;
  box.append(input);
  win.append(box);
  return { win, box, input };
}

test("a sidebar jump waits for the pin's PDF and leaves a different one alone", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = globalThis.document;
    const side = doc.createElement("div");
    side.id = "right-sidebar";
    const wrong = sidebarWindow(doc, "otherpdf1", "2");
    side.append(wrong.win);
    doc.body.append(side);
    const strings = {
      pinpdf01: "{{pdf: https://files.test/pin.pdf}}",
      otherpdf1: "{{pdf: https://files.test/other.pdf}}",
    };
    const readString = (uid) => strings[uid] || "";
    const want = { uid: "pinpdf01", url: "https://files.test/pin.pdf" };
    assert.equal(pdfTargetsMatch({ uid: "otherpdf1", url: strings.otherpdf1 }, want), false);
    assert.equal(jumpSidebarPdf(doc, 4, want, readString), false);
    assert.equal(wrong.input.value, "2");

    let now = 0;
    let sleeps = 0;
    let appeared = null;
    const found = await waitForSidebarPdf({
      doc,
      want,
      readString,
      timeout: 5000,
      step: 50,
      now: () => now,
      sleep: async (ms) => {
        sleeps += 1;
        if (sleeps > 200) throw new Error("sidebar wait did not stop");
        now += ms;
        if (sleeps === 2) {
          appeared = sidebarWindow(doc, "pinpdf01", "1");
          side.append(appeared.win);
        }
      },
    });
    assert.equal(found, appeared.box);
    assert.equal(sleeps, 2);
    assert.equal(jumpSidebarPdf(doc, 7, want, readString), true);
    assert.equal(appeared.input.value, "7");
    assert.equal(wrong.input.value, "2");

    let gone = 0;
    const stop = watchNodeGone(appeared.box, doc, () => { gone += 1; });
    appeared.win.remove();
    stub.flushMutations();
    assert.equal(gone, 1);
    doc.body.append(doc.createElement("div"));
    stub.flushMutations();
    assert.equal(gone, 1);
    stop();

    const late = sidebarWindow(doc, "", "3", "https://files.test/pin.pdf");
    const otherSide = doc.createElement("div");
    otherSide.className = "rm-right-sidebar";
    otherSide.append(late.win);
    doc.body.append(otherSide);
    assert.equal(jumpSidebarPdf(doc, 9, { url: "https://files.test/pin.pdf" }, readString), true);
    assert.equal(late.input.value, "9");
    assert.equal(wrong.input.value, "2");

    const stranger = sidebarWindow(doc, "", "5");
    otherSide.append(stranger.win);
    assert.equal(jumpSidebarPdf(doc, 6, { uid: "missingpdf" }, readString), false);
    assert.equal(stranger.input.value, "5");

    const held = sidebarWindow(doc, "heldpdf01", "1");
    side.append(held.win);
    let heldGone = 0;
    const unwatch = watchNodeGone(held.box, doc, () => { heldGone += 1; });
    unwatch();
    held.win.remove();
    stub.flushMutations();
    assert.equal(heldGone, 0);
  } finally {
    restore();
  }
});

test("a sidebar PDF that is already open is jumped without waiting", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = globalThis.document;
    const side = doc.createElement("div");
    side.id = "right-sidebar";
    const ready = sidebarWindow(doc, "pinpdf01", "3");
    side.append(ready.win);
    doc.body.append(side);
    let sleeps = 0;
    const found = await waitForSidebarPdf({
      doc,
      want: { uid: "pinpdf01" },
      timeout: 5000,
      now: () => 0,
      sleep: async () => { sleeps += 1; },
    });
    assert.equal(found, ready.box);
    assert.equal(sleeps, 0);
    let now = 0;
    const missed = await waitForSidebarPdf({
      doc,
      want: { uid: "notyetpdf" },
      timeout: 5000,
      step: 1000,
      now: () => now,
      sleep: async (ms) => {
        sleeps += 1;
        if (sleeps > 20) throw new Error("sidebar wait did not stop");
        now += ms;
      },
    });
    assert.equal(missed, null);
    const board = readFileSync(new URL("../src/view/board-view.js", import.meta.url), "utf8");
    assert.match(board, /waitForSidebarPdf\(/);
    assert.match(board, /watchNodeGone\(/);
    assert.match(board, /sourceUrl\?\.\(\)/);
    const pane = readFileSync(new URL("../src/view/read-pane.js", import.meta.url), "utf8");
    assert.match(pane, /sourceUrl:\s*\(\)\s*=>/);
    assert.match(pane, /blockUid:\s*\(\)\s*=>/);
  } finally {
    restore();
  }
});
