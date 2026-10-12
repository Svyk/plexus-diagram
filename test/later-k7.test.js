// WO N (Later list): K7 a resize never changes the reader's mode or page.
import assert from "node:assert/strict";
import test from "node:test";

import { createReadPane } from "../src/view/read-pane.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// The pane's timers run on the stub window's clock.
const flush = (stub) => { for (let i = 0; i < 6; i += 1) if (!stub.flushTimers()) break; };

function openPane() {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const root = doc.createElement("div");
  root.className = "pxd-root";
  doc.body.append(root);
  let field = null;
  const host = {
    renderBlock(node) {
      const box = doc.createElement("div");
      box.className = "rm-pdf-container";
      field = doc.createElement("input");
      field.className = "bp3-input";
      field.value = "12";
      const page = doc.createElement("div");
      page.className = "page";
      box.append(field, page);
      node.append(box);
    },
    unmount(node) { node?.replaceChildren?.(); },
    pdfHighlightTree() { return []; },
  };
  const pane = createReadPane({ doc, root, storage: stub.localStorage, host });
  pane.open({ blockUid: "blk", cardUid: "card", title: "Paper", source: "{{[[pdf]]: https://example.test/a.pdf}}" });
  return { stub, doc, root, pane, restore, field: () => field };
}

test("K7: Read + Outline survives a narrow resize and back; the mode never changes", async () => {
  const { pane, root, restore } = openPane();
  try {
    pane.element().querySelector('[data-mode="both"]').click();
    await wait(30);
    assert.equal(pane.mode(), "both");
    root._rect = { left: 0, top: 0, width: 600, height: 800, right: 600, bottom: 800 };
    pane.element()._rect = { left: 0, top: 0, width: 600, height: 400, right: 600, bottom: 400 };
    pane.layout(600);
    assert.equal(pane.mode(), "both", "a narrow resize shows the page tab, the mode stays");
    assert.equal(pane.element().classList.contains("pxd-read--both-page"), true);
    root._rect = { left: 0, top: 0, width: 1600, height: 800, right: 1600, bottom: 800 };
    pane.element()._rect = { left: 0, top: 0, width: 700, height: 800, right: 700, bottom: 800 };
    pane.layout(1600);
    assert.equal(pane.mode(), "both");
    assert.equal(pane.element().classList.contains("pxd-read--both"), true, "wide again: page and outline side by side");
    pane.dispose();
  } finally { restore(); }
});

test("K7: the page the reader showed is put back after a resize moved it", async () => {
  const { pane, root, field, restore, stub } = openPane();
  try {
    root._rect = { left: 0, top: 0, width: 1600, height: 800, right: 1600, bottom: 800 };
    pane.element()._rect = { left: 0, top: 0, width: 700, height: 800, right: 700, bottom: 800 };
    pane.layout(1600);
    flush(stub);
    assert.equal(field().value, "12");
    root._rect = { left: 0, top: 0, width: 600, height: 800, right: 600, bottom: 800 };
    pane.layout(600);
    // The reader re-fits the narrower width and its kept scroll offset lands on a later page.
    field().value = "100";
    flush(stub);
    assert.equal(field().value, "12", "the resize does not change the page");
    pane.dispose();
  } finally { restore(); }
});

test("K7: a page the user moved to during the resize is left alone", async () => {
  const { pane, root, field, restore, stub } = openPane();
  try {
    root._rect = { left: 0, top: 0, width: 1600, height: 800, right: 1600, bottom: 800 };
    pane.layout(1600);
    flush(stub);
    root._rect = { left: 0, top: 0, width: 600, height: 800, right: 600, bottom: 800 };
    pane.layout(600);
    stub.dispatch(pane.element(), "wheel");
    field().value = "40";
    flush(stub);
    assert.equal(field().value, "40");
    pane.dispose();
  } finally { restore(); }
});
