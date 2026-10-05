// PDF-7 wire: the renderer paints page chips, and an unanchored highlight end shows p. N.
import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { chipsForPdf } from "../src/model/pdf-chips.js";
import { coverModel } from "../src/model/pdf.js";
import { createItemRenderer } from "../src/view/cards.js";
import { createEdgeLayer } from "../src/view/edges.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const PDF = "{{[[pdf]]: https://example.test/self.pdf}}";
const TEXT = "selected passage";

const hlProps = (page) => ({
  ":pdf-highlight": {
    ":type": "text",
    ":content": { ":text": TEXT },
    ":position": { ":boundingRect": { ":pageNumber": page, ":x1": 1, ":y1": 2, ":x2": 9, ":y2": 4 } },
  },
});

const raw = (uid, string, props, kids = [], order = 0) => ({
  ":block/uid": uid,
  ":block/string": string,
  ":block/order": order,
  ":block/props": props,
  ":block/children": kids,
});

const plx = (o) => ({ ":plexus": o });

function boardOf() {
  return buildBoard(raw("boardpdf7", "{{[[diagram]]:PDFs}}", plx({ ":v": 2 }), [
    raw("pdfself01", PDF, plx({ ":x": 0, ":y": 0, ":w": 220, ":h": 160 }), [], 0),
    raw("hlcard02", "((hl2))", plx({ ":x": 400, ":y": 0, ":w": 200, ":h": 80 }), [], 1),
    raw("hlcard3a", "((hl3a))", plx({ ":x": 400, ":y": 120, ":w": 200, ":h": 80 }), [], 2),
    raw("hlcard3b", "((hl3b))", plx({ ":x": 400, ":y": 240, ":w": 200, ":h": 80 }), [], 3),
    raw("hlother1", "((hlx))", plx({ ":x": 400, ":y": 360, ":w": 200, ":h": 80 }), [], 4),
    raw("note0001", "a note", plx({ ":x": 0, ":y": 280, ":w": 160, ":h": 80 }), [], 5),
    raw("ec", "Connections", plx({ ":type": "edges" }), [
      raw("eNote2", "((note0001)) → ((hlcard02))", plx({ ":type": "edge", ":from": "note0001", ":to": "hlcard02" })),
      raw("e3Note", "((hlcard3a)) → ((note0001))", plx({ ":type": "edge", ":from": "hlcard3a", ":to": "note0001" }), 0, 1),
    ], 6),
  ]), {
    resolve(uid) {
      if (uid === "hl2" || uid === "hl3a" || uid === "hl3b" || uid === "hlx") return `${TEXT} #h/yellow`;
      return "";
    },
    propsOf(uid) {
      if (uid === "hl2") return { props: hlProps(2), string: TEXT, pageTitle: "fixture" };
      if (uid === "hl3a" || uid === "hl3b") return { props: hlProps(3), string: TEXT, pageTitle: "fixture" };
      if (uid === "hlx") return { props: hlProps(9), string: TEXT, pageTitle: "other" };
      return null;
    },
  });
}

const lookup = {
  source(item) { return item.string; },
  pageUid(uid) { return uid === "hlx" ? "page-other" : "page-self"; },
  pageUrl(uid) { return uid === "page-other" ? "https://example.test/other.pdf" : "https://example.test/self.pdf"; },
};

function pageText(button) {
  const badge = button.querySelector(".pxd-pdf-chip__n");
  let page = "";
  for (const node of button.childNodes) {
    if (node === badge) continue;
    page += node.textContent || "";
  }
  return page.trim();
}

test("cover and reader chips pulse page 3 and open that page on the pdf card", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const itemsLayer = doc.createElement("div");
    const sectionsLayer = doc.createElement("div");
    doc.body.append(sectionsLayer, itemsLayer);
    const idleQueue = [];
    const pending = [];
    const pulses = [];
    const opened = [];
    const writes = [];
    const board = boardOf();
    const host = {
      renderString(node, string) { node.textContent = string; },
      renderBlock(node) {
        const box = doc.createElement("div");
        box.className = "rm-pdf-container";
        node.append(box);
      },
      unmount() {},
      blockString() { return PDF; },
      pdfCover() { return coverModel({ title: "Self paper", url: "https://example.test/self.pdf", count: 3 }); },
      updateProps() { writes.push("props"); },
    };
    const r = createItemRenderer({
      doc,
      host,
      session: { updateProps() { writes.push("session"); } },
      itemsLayer,
      sectionsLayer,
      timers: {
        idle(fn) { idleQueue.push(fn); return () => {}; },
        later(fn) { pending.push(fn); return () => {}; },
      },
      pdfChips: (item) => chipsForPdf(item, board.items, lookup),
      onPdfPulse(uids) { pulses.push(uids); },
      onPdfOpen(uid, page) { opened.push([uid, page]); },
    });
    r.sync({ board, rects: worldRects(board), structural: true });
    r.setLod("detail", 1);
    r.scheduleContent({ visibleRect: { x: -100, y: -100, w: 4000, h: 2000 }, zoom: 1, tier: "detail" });
    let guard = 0;
    while (idleQueue.length && guard++ < 30) idleQueue.shift()({ timeRemaining: () => 10 });
    const shell = r.shellOf("pdfself01");
    const cover = shell.querySelector(".pxd-pdf-cover");
    const strip = cover.querySelector(".pxd-pdf-chips");
    assert.equal(strip.classList.contains("pxd-chrome"), true);
    assert.ok(cover.querySelector(".pxd-pdf-title").nextElementSibling === strip || cover.children[1] === strip);
    const buttons = [...strip.querySelectorAll("button.pxd-pdf-chip")];
    assert.deepEqual(buttons.map(pageText), ["2", "3"]);
    assert.deepEqual(buttons.map((button) => button.querySelector(".pxd-pdf-chip__n").textContent), ["1", "2"]);
    assert.equal(strip.closest(".rm-pdf-container"), null);
    stub.dispatch(buttons[1], "click");
    assert.equal(pending.length, 1);
    pending[0]();
    assert.deepEqual(pulses, [["hlcard3a", "hlcard3b"]]);
    shell.querySelector("button.pxd-pdf-open").click();
    guard = 0;
    while (idleQueue.length && guard++ < 30) idleQueue.shift()({ timeRemaining: () => 10 });
    const reader = shell.querySelector(".pxd-pdf-reader");
    const readerStrip = reader.firstChild;
    assert.equal(readerStrip.classList.contains("pxd-pdf-chips"), true);
    assert.equal(readerStrip.closest(".rm-pdf-container"), null);
    assert.ok(reader.querySelector(".rm-pdf-container"));
    const readerButtons = [...readerStrip.querySelectorAll("button.pxd-pdf-chip")];
    stub.dispatch(readerButtons[1], "click");
    stub.dispatch(readerButtons[1], "dblclick");
    const before = pulses.length;
    pending.at(-1)();
    assert.equal(pulses.length, before);
    assert.deepEqual(opened, [["pdfself01", 3]]);
    assert.equal(writes.length, 0);
    assert.equal(board.items.get("hlother1").highlight.page, 9);
  } finally {
    restore();
  }
});

test("a highlight end draws p. N with no block anchor and no bend", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    const over = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    const labels = doc.createElement("div");
    doc.body.append(svg, over, labels);
    const layer = createEdgeLayer({ doc, svg, labelsLayer: labels, overlaySvg: over, blockText: () => TEXT });
    const board = boardOf();
    const edge = board.edges.get("eNote2");
    const back = board.edges.get("e3Note");
    assert.equal(edge.toBlock, undefined);
    assert.equal(edge.fromBlock, undefined);
    assert.equal(back.toBlock, undefined);
    layer.render({ board, rects: worldRects(board), zoom: 1 });
    const pills = [...svg.querySelectorAll(".pxd-edge__page")].map((node) => node.textContent).sort();
    assert.deepEqual(pills, ["p. 2", "p. 3"]);
    assert.equal(svg.querySelectorAll(".pxd-edge__bend").length, 0);
    assert.equal(edge.toBlock, undefined);
    assert.equal(back.fromBlock, undefined);
    const hl = board.items.get("hlcard02");
    assert.equal(hl.kind, "highlight");
    assert.equal(hl.highlight.page, 2);
  } finally {
    restore();
  }
});
