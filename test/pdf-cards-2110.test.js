// PDF-1 cards: cover at rest, one reader, shield until Interact.
import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { PDF_READER_H, PDF_READER_W, coverModel } from "../src/model/pdf.js";
import { createItemRenderer } from "../src/view/cards.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const SELF = "{{[[pdf]]: https://example.test/self.pdf}}";
const REF = "{{[[pdf]]: https://example.test/ref.pdf}}";

function raw(children) {
  return {
    ":block/uid": "boardpdf1",
    ":block/string": "{{[[diagram]]:PDFs}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": children,
  };
}

function child(uid, string, order, plexus) {
  return {
    ":block/uid": uid,
    ":block/string": string,
    ":block/order": order,
    ":block/props": { ":plexus": plexus },
    ":block/children": [],
  };
}

test("a pdf cover shows the highlight count, and a second reader restores the first", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const itemsLayer = doc.createElement("div");
    const sectionsLayer = doc.createElement("div");
    doc.body.append(sectionsLayer, itemsLayer);
    const idleQueue = [];
    const writes = [];
    const rendered = [];
    const sources = [];
    const toasts = [];
    const host = {
      renderString(node, string) { node.textContent = string; },
      renderBlock(node, uid) {
        rendered.push(uid);
        const box = doc.createElement("div");
        box.className = "rm-pdf-container";
        node.append(box);
      },
      unmount() {},
      blockString(uid) { return uid === "pdfblock1" ? REF : ""; },
      pdfCover(string) {
        sources.push(string);
        if (string === SELF) return coverModel({ title: "Self paper", url: "https://example.test/self.pdf", count: 2 });
        if (string === REF) return coverModel({ title: "Ref paper", url: "https://example.test/ref.pdf", count: 2 });
        return coverModel({ count: 0 });
      },
      updateProps() { writes.push("host.updateProps"); },
    };
    const session = {
      updateProps() { writes.push("session.updateProps"); },
      setString() { writes.push("session.setString"); },
    };
    const r = createItemRenderer({
      doc,
      host,
      session,
      itemsLayer,
      sectionsLayer,
      timers: {
        idle(fn) { idleQueue.push(fn); return () => {}; },
        later() { return () => {}; },
      },
      onToast(message) { toasts.push(message); },
    });
    const board = buildBoard(raw([
      child("pdfself01", SELF, 0, { ":x": 0, ":y": 0, ":w": 220, ":h": 140 }),
      child("pdfref001", "((pdfblock1))", 1, { ":x": 400, ":y": 0, ":w": 240, ":h": 150 }),
    ]), { resolve: (uid) => (uid === "pdfblock1" ? REF : "") });
    const rects = worldRects(board);
    const flush = () => {
      let guard = 0;
      while (idleQueue.length && guard++ < 20) idleQueue.shift()({ timeRemaining: () => 10 });
    };
    r.sync({ board, rects, structural: true });
    r.setLod("detail", 1);
    r.scheduleContent({ visibleRect: { x: -100, y: -100, w: 4000, h: 2000 }, zoom: 1, tier: "detail" });
    flush();

    const self = r.shellOf("pdfself01");
    const ref = r.shellOf("pdfref001");
    assert.equal(self.querySelector(".pxd-item__header").textContent, "Self paper");
    assert.equal(ref.querySelector(".pxd-item__header").textContent, "Ref paper");
    assert.equal(self.textContent.includes("{{[[pdf]]"), false);
    assert.equal(ref.textContent.includes("((pdfblock1))"), false);
    const counts = itemsLayer.querySelectorAll(".pxd-pdf-count");
    assert.equal(counts.length, 2);
    assert.equal(counts[0].textContent, "2");
    assert.equal(counts[1].textContent, "2");
    assert.equal(counts[0].getAttribute("aria-label"), "2 highlights");
    assert.equal(counts[1].getAttribute("aria-label"), "2 highlights");
    assert.equal(self.querySelector(".pxd-pdf-title").textContent, "Self paper");
    assert.equal(ref.querySelector(".pxd-pdf-title").textContent, "Ref paper");
    const openBtn = self.querySelector("button.pxd-pdf-open.pxd-chrome");
    assert.equal(openBtn.textContent, "Open");
    assert.equal(openBtn.getAttribute("aria-label"), "Open reader");
    assert.equal(itemsLayer.querySelector(".pxd-pdf-reader"), null);
    assert.equal(rendered.length, 0);
    assert.ok(sources.includes(SELF));
    assert.ok(sources.includes(REF));
    assert.equal(sources.includes("((pdfblock1))"), false);

    openBtn.click();
    assert.equal(itemsLayer.querySelectorAll(".pxd-pdf-reader").length, 1);
    assert.equal(rendered.at(-1), "pdfself01");
    assert.equal(self.style.width, `${PDF_READER_W}px`);
    assert.equal(self.style.height, `${PDF_READER_H}px`);
    const reader = self.querySelector(".pxd-pdf-reader");
    assert.ok(reader.querySelector(".pxd-embed-shield"));
    assert.equal(reader.__pxdEmbedMo.active, true);
    const layerHits = [];
    itemsLayer.addEventListener("pointerdown", (event) => {
      layerHits.push(event.target);
      event.preventDefault();
    });
    stub.dispatch(reader.querySelector(".rm-pdf-container"), "pointerdown", { button: 0 });
    assert.equal(layerHits.length, 1);

    reader.querySelector("button.pxd-pdf-interact.pxd-chrome").click();
    assert.equal(reader.querySelector("button.pxd-pdf-interact").textContent, "Interact");
    assert.equal(self.classList.contains("pxd-pdf-live"), true);
    assert.equal(reader.querySelector(".pxd-embed-shield"), null);
    assert.equal(reader.__pxdEmbedMo.active, false);
    stub.dispatch(reader.querySelector(".rm-pdf-container"), "pointerdown", { button: 0 });
    assert.equal(layerHits.length, 1, "Interact leaves reader clicks alone");
    assert.equal(toasts.length, 0);

    r.openPdf("pdfself01");
    assert.equal(toasts.length, 0);
    assert.equal(itemsLayer.querySelectorAll(".pxd-pdf-reader").length, 1);

    r.endPdfInteract();
    assert.equal(self.classList.contains("pxd-pdf-live"), false);
    assert.ok(self.querySelector(".pxd-pdf-reader"));
    assert.ok(self.querySelector(".pxd-embed-shield"));

    r.openPdf("pdfref001");
    assert.deepEqual(toasts, ["Closed the other reader"]);
    assert.equal(itemsLayer.querySelectorAll(".pxd-pdf-reader").length, 1);
    assert.ok(self.querySelector(".pxd-pdf-cover"));
    assert.equal(self.querySelector(".pxd-pdf-reader"), null);
    assert.equal(self.style.width, "220px");
    assert.equal(self.style.height, "140px");
    assert.equal(ref.querySelector(".pxd-pdf-reader") != null, true);
    assert.ok(ref.querySelector(".pxd-embed-shield"));
    assert.equal(rendered.at(-1), "pdfblock1");
    assert.equal(rendered.includes("pdfref001"), false);
    assert.equal(ref.style.width, `${PDF_READER_W}px`);
    assert.equal(ref.style.height, `${PDF_READER_H}px`);

    r.sync({ board, rects, structural: false });
    assert.equal(itemsLayer.querySelectorAll(".pxd-pdf-reader").length, 1);
    assert.equal(ref.style.width, `${PDF_READER_W}px`);

    r.setLod("map", 0.3);
    flush();
    assert.equal(itemsLayer.querySelector(".pxd-pdf-reader"), null);
    assert.ok(ref.querySelector(".pxd-pdf-cover"));
    assert.ok(self.querySelector(".pxd-pdf-cover"));
    assert.equal(ref.style.width, "240px");
    assert.equal(ref.style.height, "150px");
    assert.equal(self.style.width, "220px");

    r.setLod("detail", 1);
    flush();
    assert.equal(itemsLayer.querySelectorAll(".pxd-pdf-reader").length, 1);
    assert.equal(ref.querySelector(".pxd-pdf-reader") != null, true);
    assert.equal(self.querySelector(".pxd-pdf-cover") != null, true);
    assert.equal(ref.style.width, `${PDF_READER_W}px`);
    assert.equal(ref.style.height, `${PDF_READER_H}px`);
    assert.deepEqual(writes, []);
    r.dispose();
  } finally {
    restore();
  }
});
