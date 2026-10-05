import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { coverModel } from "../src/model/pdf.js";
import { createChrome } from "../src/view/chrome.js";
import { createItemRenderer } from "../src/view/cards.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const SELF = "{{[[pdf]]: https://example.test/self.pdf}}";

test("Open in reader is only on a highlight card", (t) => {
  const stub = createDomStub();
  const restore = stub.install();
  t.after(restore);
  const root = stub.document.createElement("div");
  stub.document.body.append(root);
  let opened = 0;
  const chrome = createChrome({
    doc: stub.document,
    root,
    version: "2.11.3",
    settings: {},
    timers: { later: () => () => {}, frame: () => () => {} },
    on: { openInReader: () => { opened += 1; } },
  });
  const anchor = () => ({ kind: "card", rect: { x: 100, y: 100, w: 100, h: 50 } });
  chrome.ctx.show("card", { kind: "block", pinned: false, collapsed: false }, anchor);
  assert.equal(root.querySelector(".pxd-ctx__open-reader"), null);
  chrome.ctx.show("card", { kind: "highlight", pinned: false, collapsed: false }, anchor);
  const btn = root.querySelector(".pxd-ctx__open-reader");
  assert.equal(btn.getAttribute("aria-label"), "Open in reader");
  btn.click();
  assert.equal(opened, 1);
});

test("an open reader is not remounted, and a late page field is set to 2", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const itemsLayer = doc.createElement("div");
    const sectionsLayer = doc.createElement("div");
    doc.body.append(sectionsLayer, itemsLayer);
    const idleQueue = [];
    const pending = [];
    const rendered = [];
    const writes = [];
    let holdInput = false;
    const host = {
      renderString(node, string) { node.textContent = string; },
      renderBlock(node, uid) {
        rendered.push(uid);
        const box = doc.createElement("div");
        box.className = "rm-pdf-container";
        if (!holdInput) {
          const input = doc.createElement("input");
          box.append(input);
        }
        node.append(box);
      },
      unmount() {},
      blockString() { return SELF; },
      pdfCover() { return coverModel({ title: "Self paper", url: "https://example.test/self.pdf", count: 1 }); },
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
        later(fn) {
          pending.push(fn);
          return () => {
            const i = pending.indexOf(fn);
            if (i >= 0) pending.splice(i, 1);
          };
        },
      },
    });
    const board = buildBoard({
      ":block/uid": "boardpdf1",
      ":block/string": "{{[[diagram]]:PDFs}}",
      ":block/props": { ":plexus": { ":v": 2 } },
      ":block/children": [{
        ":block/uid": "pdfself01",
        ":block/string": SELF,
        ":block/order": 0,
        ":block/props": { ":plexus": { ":x": 0, ":y": 0, ":w": 220, ":h": 140 } },
        ":block/children": [],
      }],
    });
    r.sync({ board, rects: worldRects(board), structural: true });
    r.setLod("detail", 1);
    r.scheduleContent({ visibleRect: { x: -100, y: -100, w: 4000, h: 2000 }, zoom: 1, tier: "detail" });
    let guard = 0;
    while (idleQueue.length && guard++ < 20) idleQueue.shift()({ timeRemaining: () => 10 });
    const shell = r.shellOf("pdfself01");
    shell.querySelector("button.pxd-pdf-open").click();
    assert.equal(rendered.length, 1);
    const first = await r.openPdfAt("pdfself01", 2);
    assert.equal(first, true);
    assert.equal(rendered.length, 1);
    const pageInput = shell.querySelector(".rm-pdf-container input");
    assert.equal(pageInput.value, "2");
    pageInput.value = "9";
    const retarget = await r.openPdfAt("pdfself01", 1);
    assert.equal(retarget, true);
    assert.equal(rendered.length, 1);
    assert.equal(pageInput.value, "1");
    assert.equal(writes.length, 0);

    holdInput = true;
    r.openPdf("pdfself01");
    const other = buildBoard({
      ":block/uid": "boardpdf1",
      ":block/string": "{{[[diagram]]:PDFs}}",
      ":block/props": { ":plexus": { ":v": 2 } },
      ":block/children": [{
        ":block/uid": "pdfother1",
        ":block/string": "{{[[pdf]]: https://example.test/other.pdf}}",
        ":block/order": 0,
        ":block/props": { ":plexus": { ":x": 0, ":y": 0, ":w": 220, ":h": 140 } },
        ":block/children": [],
      }],
    });
    r.sync({ board: other, rects: worldRects(other), structural: true });
    r.scheduleContent({ visibleRect: { x: -100, y: -100, w: 4000, h: 2000 }, zoom: 1, tier: "detail" });
    guard = 0;
    while (idleQueue.length && guard++ < 20) idleQueue.shift()({ timeRemaining: () => 10 });
    const before = rendered.length;
    const pendingBefore = pending.length;
    const waited = r.openPdfAt("pdfother1", 2);
    assert.equal(rendered.length, before + 1);
    assert.ok(pending.length > pendingBefore);
    const box = r.shellOf("pdfother1").querySelector(".rm-pdf-container");
    const input = doc.createElement("input");
    box.append(input);
    pending.at(-1)();
    assert.equal(await waited, true);
    assert.equal(input.value, "2");
    assert.equal(writes.length, 0);
  } finally {
    restore();
  }
});
