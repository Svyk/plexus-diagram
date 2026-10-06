// PDFH-9. A row click, Place, and open() bring the highlight into view, then flash it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createReadPane } from "../src/view/read-pane.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

function rect(left, top, width, height) {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top };
}

function fiberAt(depth, highlight) {
  let node = { memoizedProps: { value: { highlight } } };
  for (let i = 0; i < depth; i += 1) node = { return: node };
  return node;
}

const ROW = {
  uid: "hlrow0001",
  string: "quoted passage #h/yellow",
  props: {
    ":pdf-highlight": {
      ":type": "text",
      ":position": { ":boundingRect": { ":pageNumber": 2 } },
    },
  },
  children: [],
};

function mount({ pageValue = "2", highlight, context, partRect, scrollerRect, onPlace } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const root = doc.createElement("div");
  root.className = "pxd-root";
  doc.body.append(root);
  const calls = [];
  const pane = createReadPane({
    doc,
    root,
    host: {
      renderBlock(node) {
        const box = doc.createElement("div");
        box.className = "rm-pdf-container";
        const input = doc.createElement("input");
        input.value = pageValue;
        const scroller = doc.createElement("div");
        scroller.className = "PdfHighlighter";
        scroller.scrollTop = 0;
        if (scrollerRect) scroller._rect = scrollerRect;
        if (context) scroller["__reactFiber$ctx"] = context(calls);
        const page = doc.createElement("div");
        page.className = "page";
        page.setAttribute("data-page-number", "2");
        const part = doc.createElement("div");
        part.className = "TextHighlight__part";
        if (partRect) part._rect = partRect;
        if (highlight) part["__reactFiber$hl"] = fiberAt(1, highlight);
        const extra = doc.createElement("div");
        extra.className = "TextHighlight__part";
        if (highlight) extra["__reactFiber$ex"] = fiberAt(0, highlight);
        page.append(part, extra);
        scroller.append(page);
        box.append(input, scroller);
        node.append(box);
      },
      pdfHighlightTree() { return [ROW]; },
    },
    onPlace,
  });
  return { stub, restore, doc, root, pane, calls };
}

test("a row click scrolls to that highlight after the page is stable, then flashes", () => {
  const highlight = { id: "hlrow0001", type: "text", color: "yellow", content: { text: "quoted passage" }, position: { pageNumber: 2 } };
  const { stub, restore, root, pane, calls } = mount({
    highlight,
    context: (calls) => ({ memoizedProps: { value: { scrollToHighlight(hl) { calls.push(hl); } } } }),
  });
  try {
    pane.open({ blockUid: "blk", cardUid: "card", title: "Paper", pageUid: "page" });
    const row = root.querySelector(".pxd-read__row");
    stub.dispatch(row, "click");
    assert.equal(calls.length, 0);
    assert.equal(root.querySelector(".pxd-read__mark-flash"), null);
    stub.flushTimers();
    assert.equal(calls.length, 1);
    assert.equal(calls[0], highlight);
    const flashed = root.querySelectorAll(".pxd-read__mark-flash");
    assert.equal(flashed.length, 2);
    assert.equal([...stub.timers].some((timer) => timer.ms === 1600), true);
    stub.flushTimers();
    assert.equal(root.querySelector(".pxd-read__mark-flash"), null);
    pane.dispose();
  } finally {
    restore();
  }
});

test("Place and open() locate the same highlight", () => {
  const highlight = { id: "hlrow0001", type: "text", color: "yellow", content: { text: "quoted passage" } };
  const placed = [];
  const first = mount({
    highlight,
    context: (calls) => ({ memoizedProps: { value: { scrollToHighlight(hl) { calls.push(hl); } } } }),
    onPlace(row) { placed.push(row.uid); },
  });
  try {
    first.pane.open({ blockUid: "blk", cardUid: "card", title: "Paper", pageUid: "page" });
    first.root.querySelector(".pxd-read__place").click();
    assert.deepEqual(placed, ["hlrow0001"]);
    assert.equal(first.calls.length, 0);
    first.stub.flushTimers();
    assert.equal(first.calls[0], highlight);
    first.pane.dispose();
  } finally {
    first.restore();
  }

  const second = mount({
    highlight,
    pageValue: "2",
    context: (calls) => ({ memoizedProps: { value: { scrollToHighlight(hl) { calls.push(hl); } } } }),
  });
  try {
    second.pane.open({
      blockUid: "blk",
      cardUid: "card",
      title: "Paper",
      pageUid: "page",
      page: 2,
      highlightUid: "hlrow0001",
    });
    assert.equal(second.calls.length, 0);
    second.stub.flushTimers();
    assert.equal(second.calls[0], highlight);
    second.pane.dispose();
  } finally {
    second.restore();
  }
});

test("a missing scrollToHighlight scrolls the first part to 30% from the top", () => {
  const highlight = { id: "hlrow0001", type: "text", color: "green", content: { text: "quoted passage" } };
  const { stub, restore, root, pane } = mount({
    highlight,
    partRect: rect(0, 200, 40, 10),
    scrollerRect: rect(0, 0, 100, 100),
  });
  try {
    pane.open({ blockUid: "blk", cardUid: "card", title: "Paper", pageUid: "page" });
    stub.dispatch(root.querySelector(".pxd-read__row"), "click");
    stub.flushTimers();
    const scroller = root.querySelector(".PdfHighlighter");
    assert.equal(scroller.scrollTop, 170);
    assert.equal(root.querySelectorAll(".pxd-read__mark-flash").length, 2);
    pane.dispose();
  } finally {
    restore();
  }
});

test("a throwing scrollToHighlight uses the same fallback, and the bag supplies a mark-less highlight", () => {
  const highlight = { id: "hlrow0001", type: "text", color: "yellow", content: { text: "quoted passage" } };
  const thrown = mount({
    highlight,
    partRect: rect(0, 200, 40, 10),
    scrollerRect: rect(0, 0, 100, 100),
    context: () => ({ memoizedProps: { value: { scrollToHighlight() { throw new Error("down"); } } } }),
  });
  try {
    thrown.pane.open({ blockUid: "blk", cardUid: "card", title: "Paper", pageUid: "page" });
    thrown.stub.dispatch(thrown.root.querySelector(".pxd-read__row"), "click");
    thrown.stub.flushTimers();
    assert.equal(thrown.root.querySelector(".PdfHighlighter").scrollTop, 170);
    thrown.pane.dispose();
  } finally {
    thrown.restore();
  }

  const fromBag = { id: "hlrow0001", type: "text", color: "blue", content: { text: "from the bag" } };
  const bag = mount({
    context: (calls) => ({
      memoizedProps: {
        value: {
          scrollToHighlight(hl) { calls.push(hl); },
          highlightsByPage: { 2: [fromBag] },
        },
      },
    }),
  });
  try {
    bag.pane.open({ blockUid: "blk", cardUid: "card", title: "Paper", pageUid: "page" });
    bag.stub.dispatch(bag.root.querySelector(".pxd-read__row"), "click");
    bag.stub.flushTimers();
    assert.equal(bag.calls[0], fromBag);
    assert.equal(bag.root.querySelector(".pxd-read__mark-flash"), null);
    bag.pane.dispose();
  } finally {
    bag.restore();
  }
});

test("the flash respects reduced motion", () => {
  const css = read("../src/css/read-pane.css");
  assert.match(css, /\.pxd-read \.pxd-read__mark-flash\s*\{[^}]*outline:\s*2px solid var\(--pxd-mark-flash/);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\.pxd-read \.pxd-read__mark-flash\s*\{[^}]*animation:\s*none/);
});
