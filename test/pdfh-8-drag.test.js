// PDFH-8. Drag a highlight mark, or a list row, onto the board. No block write.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CARD_MIME } from "../src/model/drop.js";
import { dragChipText, uidFromFiber } from "../src/model/pdf-drag.js";
import { createReadPane, highlightDropPlan } from "../src/view/read-pane.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

function fiberAt(depth, highlight) {
  let node = { memoizedProps: { value: { highlight } } };
  for (let i = 0; i < depth; i += 1) node = { return: node };
  return node;
}

function transfer() {
  const bag = {};
  let effect = "";
  let image = null;
  return {
    bag,
    image: () => image,
    effect: () => effect,
    data: {
      setData(type, value) { bag[type] = value; },
      setDragImage(node) { image = node; },
      get effectAllowed() { return effect; },
      set effectAllowed(value) { effect = value; },
    },
  };
}

test("uidFromFiber finds a highlight at depth 3 and rejects a miss or a bad id", () => {
  assert.equal(uidFromFiber(fiberAt(3, { id: "b0U1aGvkN", content: { text: "quoted" } })), "b0U1aGvkN");
  assert.equal(uidFromFiber(fiberAt(9, { id: "b0U1aGvkN" })), "b0U1aGvkN");
  assert.equal(uidFromFiber(fiberAt(10, { id: "b0U1aGvkN" })), null);
  assert.equal(uidFromFiber({ return: { memoizedProps: { value: {} } } }), null);
  assert.equal(uidFromFiber(null), null);
  assert.equal(uidFromFiber(fiberAt(0, { id: "short" })), null);
  assert.equal(uidFromFiber(fiberAt(0, { id: "has space" })), null);
  assert.equal(uidFromFiber(fiberAt(0, { id: 123456789 })), null);
  assert.equal(uidFromFiber(fiberAt(0, { id: "b0U1aGvkN" }), () => false), null);
  assert.equal(uidFromFiber(fiberAt(0, { id: "b0U1aGvkN" }), () => { throw new Error("down"); }), null);
  assert.equal(uidFromFiber(fiberAt(0, { id: "b0U1aGvkN" }), () => true), "b0U1aGvkN");
  const long = "A measured sentence from the page that runs past sixty characters easily";
  assert.equal(dragChipText(long).length, 60);
  assert.equal(dragChipText(long), long.slice(0, 60));
});

test("a placed highlight drop pulses the card that is already on the board", () => {
  const items = [{ kind: "highlight", uid: "card9", target: { uid: "b0U1aGvkN" } }];
  assert.deepEqual(highlightDropPlan([{ string: "((b0U1aGvkN))" }], items), { kind: "pulse", uid: "card9" });
  assert.deepEqual(highlightDropPlan([{ string: "((freshuid1))" }], items), { kind: "cards" });
});

function rect(left, top, width, height) {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top };
}

test("a text-layer span over a mark rect arms, and a point outside restores draggable", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const root = doc.createElement("div");
    root.className = "pxd-root";
    doc.body.append(root);
    const before = stub.listenerCount();
    let selecting = false;
    const pane = createReadPane({
      doc,
      root,
      host: {
        blockString(uid) { return uid === "missing01" ? null : "quoted"; },
        renderBlock(node) {
          const box = doc.createElement("div");
          box.className = "rm-pdf-container";
          const scroller = doc.createElement("div");
          scroller.className = "PdfHighlighter";
          scroller["__reactFiber$ctx"] = {
            memoizedProps: { value: { scrollToHighlight() {}, isSelectionInProgress: () => selecting } },
          };
          box.append(scroller);
          node.append(box);
        },
      },
    });
    pane.open({ blockUid: "blk", cardUid: "card", title: "Paper", pageUid: "page" });
    const scroller = root.querySelector(".PdfHighlighter");
    const quote = "A measured sentence from the page that runs past sixty characters easily";
    const page = doc.createElement("div");
    page.className = "page";
    page.setAttribute("data-page-number", "1");
    const part = doc.createElement("div");
    part.className = "TextHighlight__part";
    part._rect = rect(10, 10, 40, 12);
    part["__reactFiber$test"] = fiberAt(3, {
      id: "b0U1aGvkN",
      type: "text",
      color: "yellow",
      content: { text: quote },
    });
    const span = doc.createElement("span");
    span.setAttribute("draggable", "false");
    const other = doc.createElement("span");
    const bad = doc.createElement("div");
    bad.className = "TextHighlight__part";
    bad._rect = rect(80, 10, 20, 12);
    bad["__reactFiber$bad"] = fiberAt(0, { id: "nope" });
    const missing = doc.createElement("div");
    missing.className = "AreaHighlight";
    missing._rect = rect(120, 10, 20, 12);
    missing["__reactFiber$miss"] = fiberAt(0, { id: "missing01", type: "area" });
    const wrap = doc.createElement("div");
    wrap.className = "rm-pdf-highlight-container";
    wrap["__reactFiber$wrap"] = fiberAt(0, { id: "wrapuid01", type: "text", content: { text: "from container" } });
    const child = doc.createElement("div");
    child.className = "TextHighlight__part";
    child._rect = rect(200, 10, 30, 12);
    wrap.append(child);
    const area = doc.createElement("div");
    area.className = "AreaHighlight__part";
    area._rect = rect(260, 10, 30, 12);
    area["__reactFiber$area"] = fiberAt(0, { id: "hlarea001", type: "area", content: { text: "" } });
    page.append(part, span, other, bad, missing, wrap, area);
    const pageTwo = doc.createElement("div");
    pageTwo.className = "page";
    pageTwo.setAttribute("data-page-number", "2");
    const foreign = doc.createElement("div");
    foreign.className = "TextHighlight__part";
    foreign._rect = rect(10, 10, 40, 12);
    foreign["__reactFiber$foreign"] = fiberAt(0, { id: "foreign01", content: { text: "other page" } });
    pageTwo.append(foreign);
    scroller.append(page, pageTwo);

    let hits = 0;
    let foreignHits = 0;
    const partRect = part.getBoundingClientRect;
    part.getBoundingClientRect = () => { hits += 1; return partRect(); };
    const foreignRect = foreign.getBoundingClientRect;
    foreign.getBoundingClientRect = () => { foreignHits += 1; return foreignRect(); };

    const live = root.querySelector(".pxd-read__live");
    let clicks = 0;
    let downs = 0;
    let ups = 0;
    const onClick = () => { clicks += 1; };
    const onDown = () => { downs += 1; };
    const onUp = () => { ups += 1; };
    span.addEventListener("click", onClick);
    span.addEventListener("pointerdown", onDown);
    span.addEventListener("mouseup", onUp);
    const down = stub.dispatch(span, "pointerdown");
    const up = stub.dispatch(span, "mouseup");
    const click = stub.dispatch(span, "click");
    assert.equal(down.defaultPrevented, false);
    assert.equal(up.defaultPrevented, false);
    assert.equal(click.defaultPrevented, false);
    assert.equal(downs, 1);
    assert.equal(ups, 1);
    assert.equal(clicks, 1);

    const early = transfer();
    stub.dispatch(span, "dragstart", { dataTransfer: early.data });
    assert.equal(early.bag[CARD_MIME], undefined);

    stub.dispatch(span, "pointermove", { clientX: 20, clientY: 16 });
    stub.dispatch(span, "pointermove", { clientX: 22, clientY: 16 });
    stub.dispatch(span, "pointermove", { clientX: 24, clientY: 16 });
    assert.equal(hits, 0);
    assert.notEqual(span.getAttribute("draggable"), "true");
    stub.flushFrames();
    assert.equal(hits, 1);
    assert.equal(foreignHits, 0);
    assert.equal(span.draggable, true);
    assert.equal(span.getAttribute("draggable"), "true");
    assert.equal(live.classList.contains("pxd-read__live--overmark"), true);
    assert.notEqual(part.getAttribute("draggable"), "true");

    stub.dispatch(span, "pointermove", { clientX: 1, clientY: 1 });
    stub.flushFrames();
    assert.equal(hits, 2);
    assert.equal(span.getAttribute("draggable"), "false");
    assert.equal(span.draggable, false);
    assert.equal(live.classList.contains("pxd-read__live--overmark"), false);

    stub.dispatch(other, "pointermove", { clientX: 20, clientY: 16 });
    stub.flushFrames();
    assert.equal(other.getAttribute("draggable"), "true");
    assert.equal(span.getAttribute("draggable"), "false");
    stub.dispatch(other, "pointermove", { clientX: 1, clientY: 1 });
    stub.flushFrames();
    assert.equal(other.getAttribute("draggable"), null);
    assert.notEqual(other.draggable, true);

    stub.dispatch(span, "pointermove", { clientX: 90, clientY: 16 });
    stub.flushFrames();
    assert.notEqual(span.getAttribute("draggable"), "true");
    stub.dispatch(span, "pointermove", { clientX: 130, clientY: 16 });
    stub.flushFrames();
    assert.notEqual(span.getAttribute("draggable"), "true");

    stub.dispatch(span, "pointermove", { clientX: 210, clientY: 16 });
    stub.flushFrames();
    assert.equal(span.getAttribute("draggable"), "true");
    const wrapped = transfer();
    stub.dispatch(span, "dragstart", { dataTransfer: wrapped.data });
    assert.equal(wrapped.bag[CARD_MIME], "((wrapuid01))");
    stub.dispatch(span, "dragend");
    assert.equal(span.getAttribute("draggable"), "false");

    stub.dispatch(span, "pointermove", { clientX: 270, clientY: 16 });
    stub.flushFrames();
    assert.equal(span.getAttribute("draggable"), "true");
    const areaDrag = transfer();
    stub.dispatch(span, "dragstart", { dataTransfer: areaDrag.data });
    assert.equal(areaDrag.bag[CARD_MIME], "((hlarea001))");
    stub.dispatch(span, "dragend");

    stub.dispatch(span, "pointermove", { clientX: 20, clientY: 16 });
    stub.flushFrames();
    const drag = transfer();
    const started = stub.dispatch(span, "dragstart", { dataTransfer: drag.data });
    assert.equal(started.defaultPrevented, false);
    assert.equal(drag.bag[CARD_MIME], "((b0U1aGvkN))");
    assert.equal(drag.bag["text/plain"], "((b0U1aGvkN))");
    assert.equal(drag.effect(), "copy");
    assert.equal(drag.image()?.classList.contains("pxd-read__drag"), true);
    assert.equal(drag.image().style.left, "-1000px");
    assert.equal(drag.image().querySelector(".pxd-read__dragtext").textContent, quote.slice(0, 60));
    assert.equal(drag.image().querySelector(".pxd-read__bar").getAttribute("data-color"), "yellow");
    assert.equal(root.classList.contains("pxd-root--pdf-drag"), true);

    let cleared = 0;
    doc.getSelection = () => ({
      anchorNode: span,
      rangeCount: 1,
      removeAllRanges() { cleared += 1; },
    });
    stub.dispatch(root, "drop");
    assert.equal(root.classList.contains("pxd-root--pdf-drag"), false);
    stub.dispatch(span, "dragend");
    assert.equal(cleared, 1);
    assert.equal(drag.image().isConnected, false);
    assert.equal(root.querySelector(".pxd-read__drag"), null);
    assert.equal(live.classList.contains("pxd-read__live--overmark"), false);
    assert.equal(span.getAttribute("draggable"), "false");

    doc.getSelection = () => ({
      anchorNode: root,
      rangeCount: 1,
      removeAllRanges() { cleared += 1; },
    });
    stub.dispatch(span, "pointermove", { clientX: 20, clientY: 16 });
    stub.flushFrames();
    const again = transfer();
    stub.dispatch(span, "dragstart", { dataTransfer: again.data });
    stub.dispatch(span, "dragend");
    assert.equal(cleared, 1);
    assert.equal(root.classList.contains("pxd-root--pdf-drag"), false);

    const plain = transfer();
    stub.dispatch(other, "dragstart", { dataTransfer: plain.data });
    assert.equal(plain.bag[CARD_MIME], undefined);
    assert.equal(root.classList.contains("pxd-root--pdf-drag"), false);

    stub.dispatch(span, "pointermove", { clientX: 20, clientY: 16 });
    stub.flushFrames();
    assert.equal(span.getAttribute("draggable"), "true");
    const shifted = stub.dispatch(span, "pointerdown", { shiftKey: true });
    assert.equal(shifted.defaultPrevented, false);
    assert.equal(span.getAttribute("draggable"), "false");
    assert.equal(live.classList.contains("pxd-read__live--overmark"), false);

    selecting = true;
    stub.dispatch(span, "pointermove", { clientX: 20, clientY: 16 });
    stub.flushFrames();
    assert.notEqual(span.getAttribute("draggable"), "true");
    selecting = false;

    span.removeEventListener("click", onClick);
    span.removeEventListener("pointerdown", onDown);
    span.removeEventListener("mouseup", onUp);
    pane.dispose();
    assert.equal(pane.isOpen(), false);
    assert.equal(stub.listenerCount(), before);
    assert.equal(root.classList.contains("pxd-root--pdf-drag"), false);
  } finally {
    restore();
  }
});

test("the list row body drags with the same chip", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const root = doc.createElement("div");
    root.className = "pxd-root";
    doc.body.append(root);
    const passage = "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz0123456789EXTRA";
    const pane = createReadPane({
      doc,
      root,
      host: {
        renderBlock(node) {
          const box = doc.createElement("div");
          box.className = "rm-pdf-container";
          node.append(box);
        },
        pdfHighlightTree() {
          return [{
            uid: "hlrow0001",
            string: `${passage} #h/green`,
            props: {
              ":pdf-highlight": {
                ":type": "text",
                ":position": { ":boundingRect": { ":pageNumber": 2 } },
              },
            },
            children: [],
          }];
        },
      },
    });
    pane.open({ blockUid: "blk", cardUid: "card", title: "Paper", pageUid: "page" });
    const row = root.querySelector(".pxd-read__row");
    assert.equal(row.draggable, true);
    assert.equal(row.getAttribute("draggable"), "true");
    assert.equal(row.querySelector(".pxd-read__handle"), null);
    assert.notEqual(row.querySelector(".pxd-read__snip").draggable, true);
    const drag = transfer();
    stub.dispatch(row.querySelector(".pxd-read__snip"), "dragstart", { dataTransfer: drag.data });
    assert.equal(drag.bag[CARD_MIME], "((hlrow0001))");
    assert.equal(drag.bag["text/plain"], "((hlrow0001))");
    assert.equal(drag.effect(), "copy");
    assert.equal(drag.image().querySelector(".pxd-read__dragtext").textContent, passage.slice(0, 60));
    assert.equal(drag.image().querySelector(".pxd-read__bar").getAttribute("data-color"), "green");
    assert.equal(root.classList.contains("pxd-root--pdf-drag"), true);
    stub.dispatch(row, "dragend");
    assert.equal(root.classList.contains("pxd-root--pdf-drag"), false);
    assert.equal(root.querySelector(".pxd-read__drag"), null);
    pane.dispose();
  } finally {
    restore();
  }
});

test("the pane source does not capture the pointer or listen on document", () => {
  const paneSrc = read("../src/view/read-pane.js");
  const css = read("../src/css/read-pane.css");
  assert.equal(paneSrc.includes("setPointerCapture"), false);
  assert.equal(paneSrc.includes("document.addEventListener"), false);
  assert.equal(paneSrc.includes("doc.addEventListener"), false);
  assert.match(css, /\.pxd-root\.pxd-root--pdf-drag > \.pxd-viewport\s*\{[^}]*outline:\s*2px dashed/);
  assert.match(css, /\.pxd-root--dark\.pxd-root--pdf-drag > \.pxd-viewport\s*\{[^}]*background:\s*none/);
  assert.match(css, /\.pxd-root--dark\.pxd-root--pdf-drag > \.pxd-viewport\s*\{[^}]*border:\s*2px dashed/);
});
