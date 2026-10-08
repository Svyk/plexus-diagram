// PDF card polish (feat/pdf-card-polish): card face badges and page bar, Quick Look on a PDF, the stacked
// reader's minimap and context bar, the outline's start position, and the open-time page-field watch.
import assert from "node:assert/strict";
import test from "node:test";

import {
  avoidDock,
  boardCramped,
  countText,
  flipArrowsShown,
  freeBoardArea,
  pdfDockLift,
  quickLookTitle,
  readerLimit,
  startPage,
} from "../src/model/card-face.js";
import { createChrome } from "../src/view/chrome.js";
import { createParseView, outlineIndent, outlineScrollTop } from "../src/view/parse-view.js";
import { createPdfFlip } from "../src/view/pdf-flip.js";
import { createQuickLook } from "../src/view/quicklook.js";
import { createDomStub } from "./fixtures/dom-stub.js";

function fakePdf(pages = 3) {
  const made = [];
  return {
    made,
    GlobalWorkerOptions: { workerSrc: "https://example.test/pdf.worker.js" },
    getDocument({ url }) {
      const doc = {
        url,
        numPages: pages,
        destroyed: false,
        getPage(n) {
          return Promise.resolve({
            number: n,
            getViewport({ scale }) { return { width: 100 * scale, height: 140 * scale, scale }; },
            render() { return { promise: Promise.resolve(true), cancel() {} }; },
          });
        },
        destroy() { doc.destroyed = true; },
      };
      made.push(doc);
      return { promise: Promise.resolve(doc), destroy() { doc.destroyed = true; } };
    },
  };
}

const settle = async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setImmediate(r)); };

test("badge counts are singular at one: 1 ref, 2 refs, on 1 board", () => {
  assert.equal(countText(1, "ref", "refs"), "1 ref");
  assert.equal(countText(2, "ref", "refs"), "2 refs");
  assert.equal(countText(0, "ref", "refs"), "0 refs");
  assert.equal(countText("3", "board", "boards"), "3 boards");
  assert.equal(countText(1, "board", "boards"), "1 board");
  assert.equal(countText(-4, "ref", "refs"), "0 refs");
  assert.equal(countText(Number.NaN, "ref", "refs"), "0 refs");
});

test("the page bar shows arrows only for a document with more than one page", () => {
  assert.equal(flipArrowsShown(1), false);
  assert.equal(flipArrowsShown(0), false);
  assert.equal(flipArrowsShown("x"), false);
  assert.equal(flipArrowsShown(2), true);
  assert.equal(flipArrowsShown(9), true);
});

test("a single-page PDF's in-card bar has no arrows; a nine-page one keeps them and reports its page", async () => {
  const stub = createDomStub();
  const hosts = new Map();
  const paper = () => { const host = stub.document.createElement("div"); host.className = "pxd-pdf-paper"; return host; };
  hosts.set("one", paper());
  hosts.set("nine", paper());
  for (const [uid, pages] of [["one", 1], ["nine", 9]]) {
    const flip = createPdfFlip({
      doc: stub.document,
      win: stub.window,
      lib: fakePdf(pages),
      urlOf: () => `https://example.test/${uid}.pdf`,
      hostOf: (id) => hosts.get(id) || null,
      sizeOf: () => ({ cssW: 200, cssH: 260, dpr: 1 }),
    });
    flip.setSelected(uid);
    await flip.idle();
    const bar = hosts.get(uid).querySelector(".pxd-pdf-bar");
    const steps = bar.querySelectorAll(".pxd-pdf-bar__step");
    assert.equal(steps.length, 2);
    if (pages === 1) {
      assert.equal(bar.querySelector(".pxd-pdf-bar__pages").textContent, "1 / 1");
      assert.ok(steps.every((s) => s.hasAttribute("hidden")), "no arrows on one page");
      assert.ok(bar.classList.contains("pxd-pdf-bar--single"));
    } else {
      assert.ok(steps.every((s) => !s.hasAttribute("hidden")));
      assert.equal(flip.consumeKey("ArrowRight"), true);
      await flip.idle();
      assert.equal(flip.pageOf(uid), 2);
      assert.equal(flip.totalOf(uid), 9);
      assert.equal(flip.pageOf("other"), 1, "a card that is not live reads page 1");
    }
    flip.destroy();
  }
});

test("Quick Look titles: the display title, never the raw macro or a ref", () => {
  const raw = { kind: "pdf", string: "{{[[pdf]]: https://firebasestorage.googleapis.com/v0/b/x.pdf}}", title: "{{[[pdf]]: https://x}}" };
  assert.equal(quickLookTitle(raw, "Science of the Total Environment"), "Science of the Total Environment");
  assert.equal(quickLookTitle(raw, ""), "PDF");
  assert.equal(quickLookTitle(raw, "{{[[pdf]]: https://x}}"), "PDF");
  assert.equal(quickLookTitle({ kind: "pdf", string: "((abcdefghi))", title: "Paper alias" }, ""), "Paper alias");
  assert.equal(startPage(undefined, 9), 1);
  assert.equal(startPage(4, 9), 4);
  assert.equal(startPage(12, 9), 9);
  assert.equal(startPage(0, 0), 1);
});

test("Quick Look on a PDF draws the card's page with pdf.js, pages with arrows, and destroys the document on close", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const root = doc.createElement("div");
    root.className = "pxd-root";
    doc.body.append(root);
    const rendered = [];
    const lib = fakePdf(3);
    const ql = createQuickLook({
      doc,
      root,
      win: stub.window,
      pdfLib: lib,
      host: { renderString: (n, s) => rendered.push(s), unmount() {} },
      on: {
        titleOf: () => "Novel risk assessment",
        pdfOf: () => ({ url: "https://example.test/paper.pdf", page: 2 }),
      },
    });
    ql.open({ uid: "p1", kind: "pdf", type: "card", string: "{{[[pdf]]: https://example.test/paper.pdf}}", content: [], target: { kind: "self", uid: "p1" } });
    await settle();
    const node = root.querySelector(".pxd-quicklook");
    assert.ok(node.classList.contains("pxd-quicklook--pdf"));
    assert.equal(node.querySelector(".pxd-ql__title").textContent, "Novel risk assessment");
    assert.deepEqual(rendered, [], "Roam's reader is not mounted");
    assert.equal(node.querySelector(".pxd-ql__pages").textContent, "2 / 3", "opens on the card's page");
    assert.ok(node.querySelector("canvas.pxd-ql__canvas"));
    stub.dispatch(doc.body, "keydown", { key: "ArrowRight" });
    await settle();
    assert.equal(node.querySelector(".pxd-ql__pages").textContent, "3 / 3");
    stub.dispatch(doc.body, "keydown", { key: "ArrowRight" });
    assert.equal(node.querySelector(".pxd-ql__pages").textContent, "3 / 3", "stays on the last page");
    node.querySelectorAll(".pxd-ql__step")[0].click();
    await settle();
    assert.equal(node.querySelector(".pxd-ql__pages").textContent, "2 / 3");
    ql.close();
    assert.equal(lib.made[0].destroyed, true);
    ql.dispose();
  } finally {
    restore();
  }
});

test("Quick Look falls back to Roam's reader for an encrypted upload, still with the display title", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const root = doc.createElement("div");
    root.className = "pxd-root";
    doc.body.append(root);
    const rendered = [];
    const lib = fakePdf(3);
    const ql = createQuickLook({
      doc,
      root,
      win: stub.window,
      pdfLib: lib,
      host: { renderString: (n, s) => rendered.push(s), unmount() {} },
      on: { titleOf: () => "Report", pdfOf: () => ({ url: "https://example.test/a.pdf.enc", page: 1 }) },
    });
    const source = "{{[[pdf]]: https://example.test/a.pdf.enc}}";
    ql.open({ uid: "p2", kind: "pdf", type: "card", string: source, content: [], target: { kind: "self", uid: "p2" } });
    await settle();
    const node = root.querySelector(".pxd-quicklook");
    assert.ok(node.classList.contains("pxd-quicklook--pdf-roam"));
    assert.equal(node.querySelector(".pxd-ql__title").textContent, "Report");
    assert.deepEqual(rendered, [source]);
    assert.equal(lib.made.length, 0);
    ql.dispose();
  } finally {
    restore();
  }
});

test("the minimap needs 420 × 280 px of board below the board bar", () => {
  assert.equal(boardCramped({ width: 518, height: 354 }), false);
  assert.equal(boardCramped({ width: 518, height: 279 }), true);
  assert.equal(boardCramped({ width: 419, height: 600 }), true);
  assert.equal(boardCramped(null), false);
  const free = freeBoardArea({ top: 45, width: 518, height: 354 }, { bottom: 128, height: 39 });
  assert.deepEqual(free, { width: 518, height: 271 });
  assert.equal(boardCramped(free), true, "the stacked reader under a narrow board hides the minimap");
  assert.deepEqual(freeBoardArea({ top: 45, width: 900, height: 600 }, null), { width: 900, height: 600 });
});

test("the reader is a right edge beside the board and a bottom edge under it", () => {
  const root = { left: 232, top: 45, width: 518, height: 656 };
  assert.deepEqual(readerLimit(root, { left: 232, top: 400, width: 518, height: 301 }), { bottom: 355 });
  assert.deepEqual(readerLimit(root, { left: 450, top: 45, width: 300, height: 656 }), { right: 218 });
  assert.equal(readerLimit(root, null), null);
  assert.equal(readerLimit(root, { left: 0, top: 0, width: 0, height: 0 }), null);
});

test("the context bar hops over the dock: above the card when there is room, else clear above the dock", () => {
  const dock = { left: 8, top: 302, right: 458, bottom: 346 };
  const bar = { left: 8, top: 300, w: 457, h: 38 };
  const above = avoidDock(bar, { card: { x: 118, y: 200, w: 282, h: 376 }, dock, gap: 10, topLimit: 90 });
  assert.equal(above.top, 152);
  const hop = avoidDock(bar, { card: { x: 118, y: 120, w: 282, h: 376 }, dock, gap: 10, topLimit: 90 });
  assert.equal(hop.top, 302 - 8 - 38);
  const clear = { left: 8, top: 400, w: 457, h: 38 };
  assert.equal(avoidDock(clear, { card: { x: 0, y: 0, w: 10, h: 10 }, dock }), clear);
  assert.equal(avoidDock(bar, { dock: null }), bar);
});

test("a PDF card's controls rise above the dock, the context bar and a stacked reader", () => {
  const card = { left: 350, top: 185, w: 282, h: 376 };
  const dock = { left: 240, top: 519, right: 690, bottom: 565 };
  assert.equal(pdfDockLift(card, dock, 1), 561 - 513);
  assert.equal(pdfDockLift(card, dock, 2), Math.round((561 - 513) / 2));
  assert.equal(pdfDockLift(card, { left: 0, top: 600, right: 900, bottom: 640 }, 1), 0, "a dock below the card");
  assert.equal(pdfDockLift(card, { left: 700, top: 519, right: 900, bottom: 565 }, 1), 0, "a dock beside the card");
  // Stacked reader: the board ends at 392; the dock and the context bar sit on that edge, one above the other.
  const ctx = { left: 240, top: 302, right: 697, bottom: 340 };
  const lowDock = { left: 240, top: 347, right: 690, bottom: 391 };
  assert.equal(pdfDockLift(card, [lowDock, ctx], 1, { clipBottom: 392 }), 561 - 296);
  assert.equal(pdfDockLift(card, [], 1, { clipBottom: 392 }), 561 - 386, "the hidden bottom alone still lifts");
  assert.equal(pdfDockLift(card, { left: 240, top: 200, right: 690, bottom: 560 }, 1), 0, "nothing helps above the top band");
});

test("chrome: a stacked reader keeps the context bar's tools and keeps the bar above the reader", (t) => {
  const stub = createDomStub({ width: 520, height: 656 });
  const restore = stub.install();
  t.after(restore);
  const root = stub.document.createElement("div");
  root.className = "pxd-root";
  stub.document.body.append(root);
  const chrome = createChrome({ doc: stub.document, root, version: "1.2.0", settings: {}, timers: { later: () => () => {}, frame: () => () => {} }, on: { delete() {}, copyRef() {}, duplicate() {}, sendTo() {}, fitHeight() {} } });
  root.classList.add("pxd-root--read", "pxd-root--read-stack");
  const pane = stub.document.createElement("div");
  pane.className = "pxd-read pxd-read--stack";
  pane._rect = { left: 0, top: 400, width: 520, height: 256, right: 520, bottom: 656, x: 0, y: 400 };
  root.append(pane);
  chrome.ctx.show("card", { kind: "block" }, () => ({ kind: "card", rect: { x: 120, y: 330, w: 280, h: 300 } }));
  const row = root.querySelector(".pxd-ctx__row");
  for (const k of row.children) k._rect = { left: 0, top: 0, width: 28, height: 28, right: 28, bottom: 28, x: 0, y: 0 };
  const ctx = root.querySelector(".pxd-ctx");
  ctx._rect = { left: 0, top: 0, width: 300, height: 38, right: 300, bottom: 38, x: 0, y: 0 };
  chrome.ctx.reposition();
  const visible = [...row.children].filter((k) => k.style.display !== "none" && !String(k.className).includes("pxd-ctx__more"));
  assert.ok(visible.length > 4, `kept ${visible.length} tools, not a lone "…"`);
  assert.ok(Number.parseFloat(ctx.style.top) + 38 <= 400, `bar top ${ctx.style.top} stays above the reader`);
  // The pane closes: the full row comes back.
  pane.remove();
  root.classList.remove("pxd-root--read", "pxd-root--read-stack");
  chrome.ctx.reposition();
  assert.equal([...row.children].filter((k) => k.style.display === "none").length, 0);
  assert.equal(root.querySelector(".pxd-ctx__more"), null);
});

test("outline rows indent 8 px a level and the scroll target is measured from the body", () => {
  assert.equal(outlineIndent(1), 0);
  assert.equal(outlineIndent(2), 8);
  assert.equal(outlineIndent(9), 40);
  assert.equal(outlineIndent(undefined), 0);
  const body = { scrollTop: 50, getBoundingClientRect: () => ({ top: 100, height: 300 }) };
  const node = { offsetTop: 999, getBoundingClientRect: () => ({ top: 260, height: 20 }) };
  assert.equal(outlineScrollTop(node, body), 210);
  assert.equal(outlineScrollTop({ offsetTop: 40 }, {}), 40);
});

test("the outline starts at the top, and one page field gets one watch however often the pane asks", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const view = createParseView({ doc });
    doc.body.append(view.element());
    const input = doc.createElement("input");
    input.value = "9";
    doc.body.append(input);
    const before = stub.listenerCount();
    assert.equal(view.watchPageInput(input), true);
    const one = stub.listenerCount();
    assert.equal(view.watchPageInput(input), false, "same field: no second watch");
    assert.equal(view.watchPageInput(input), false);
    assert.equal(stub.listenerCount(), one);
    assert.ok(one > before);
    assert.equal(view.scrollToPage(1), 0);
    assert.equal(view.scrollToPage(undefined), 0);
    const other = doc.createElement("input");
    assert.equal(view.watchPageInput(other), true, "a new reader's field replaces the old watch");
    assert.equal(stub.listenerCount(), one, "the old field's listener is gone");
    view.dispose();
  } finally {
    restore();
  }
});
