// PDFH-6. Area rows stay images. A tag rewrite does not touch Roam's highlight props.
import assert from "node:assert/strict";
import test from "node:test";

import { CARD_MIME } from "../src/model/drop.js";
import { highlightModel, rewriteHighlightTag } from "../src/model/highlight.js";
import { highlightRows } from "../src/model/highlight-pick.js";
import { HIGHLIGHT_MARK_TIP, buildColorPicker } from "../src/view/color-picker.js";
import { createReadPane } from "../src/view/read-pane.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const TIP = "The card and the list follow the tag. The mark painted in the PDF may stay yellow; Roam's reader changes it.";
const IMAGE = "![shot](https://example.test/a.png)";

const areaProps = () => ({
  ":pdf-highlight": {
    ":type": "area",
    ":position": { ":boundingRect": { ":pageNumber": 2 } },
  },
  ":image-size": { ":width": 133, ":height": 47 },
});

test("an area row uses the image ratio and drags as one block ref", () => {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const root = doc.createElement("div");
  root.className = "pxd-root";
  doc.body.append(root);
  const rendered = [];
  const props = areaProps();
  const tree = [{
    uid: "hlarea01",
    string: `${IMAGE} #h/yellow`,
    props,
    children: [],
  }, {
    uid: "hltext01",
    string: "quoted passage #h/green",
    props: {
      ":pdf-highlight": {
        ":type": "text",
        ":position": { ":boundingRect": { ":pageNumber": 1 } },
      },
    },
    children: [],
  }, {
    uid: "hlimg0001",
    string: `see ${IMAGE} #h/blue`,
    props: {
      ":pdf-highlight": {
        ":type": "text",
        ":position": { ":boundingRect": { ":pageNumber": 3 } },
      },
      ":image-size": { ":width": 20, ":height": 10 },
    },
    children: [],
  }];
  const host = {
    renderString(node, string) {
      rendered.push(string);
      node.textContent = string;
    },
    renderBlock(node) {
      const box = doc.createElement("div");
      box.className = "rm-pdf-container";
      node.append(box);
    },
    pdfHighlightTree() { return tree; },
  };
  const pane = createReadPane({ doc, root, host });
  try {
    pane.open({ blockUid: "pdfblock1", cardUid: "pdfcard01", title: "Paper", pageUid: "pagepdf01" });
    const rowBy = (uid) => [...root.querySelectorAll(".pxd-read__row")].find((node) => node.getAttribute("data-uid") === uid);
    const area = rowBy("hlarea01");
    const media = area.querySelector(".pxd-read__media");
    assert.equal(media.style.aspectRatio, "133 / 47");
    assert.equal(area.querySelector(".pxd-read__snip"), null);
    assert.equal(rendered.some((string) => string.includes(IMAGE) && string.includes("#h/yellow")), true);
    assert.equal(area.querySelector(".pxd-read__bar").getAttribute("data-color"), "yellow");
    const bag = {};
    stub.dispatch(area, "dragstart", {
      dataTransfer: { setData(type, value) { bag[type] = value; } },
    });
    assert.equal(bag[CARD_MIME], "((hlarea01))");
    assert.equal(bag["text/plain"], "((hlarea01))");

    const text = rowBy("hltext01");
    assert.equal(text.querySelector(".pxd-read__media"), null);
    assert.equal(text.querySelector(".pxd-read__snip").textContent, "quoted passage");

    const pictured = rowBy("hlimg0001");
    assert.equal(pictured.querySelector(".pxd-read__media").style.aspectRatio, "20 / 10");
    assert.equal(pictured.querySelector(".pxd-read__snip"), null);
    pane.dispose();
  } finally {
    restore();
  }
});

test("rewriting the tag leaves :pdf-highlight and :image-size untouched", () => {
  const props = areaProps();
  const before = structuredClone(props);
  const next = rewriteHighlightTag(`${IMAGE} #h/yellow`, "green");
  assert.equal(next, `${IMAGE} #h/green`);
  assert.deepEqual(props, before);
  const model = highlightModel({ props, string: next, pageTitle: "Paper" });
  assert.equal(model.color, "green");
  assert.equal(model.image, true);
  assert.deepEqual(model.natural, { w: 133, h: 47 });
  assert.deepEqual(props, before);
  const rows = highlightRows([{ uid: "hlarea01", string: next, props, children: [] }]);
  assert.equal(rows[0].color, "green");
  assert.deepEqual(props, before);

  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const root = doc.createElement("div");
    root.className = "pxd-root";
    doc.body.append(root);
    const pane = createReadPane({
      doc,
      root,
      host: {
        renderString(node, string) { node.textContent = string; },
        renderBlock(node) {
          const box = doc.createElement("div");
          box.className = "rm-pdf-container";
          node.append(box);
        },
        pdfHighlightTree() { return [{ uid: "hlarea01", string: next, props, children: [] }]; },
      },
    });
    pane.open({ blockUid: "pdfblock1", cardUid: "pdfcard01", title: "Paper", pageUid: "pagepdf01" });
    const bar = root.querySelector(".pxd-read__bar");
    assert.equal(bar.getAttribute("data-color"), "green");
    assert.equal(root.querySelector(".pxd-read__media").style.aspectRatio, "133 / 47");
    assert.deepEqual(props, before);
    pane.dispose();
  } finally {
    restore();
  }
});

test("the highlight colour tooltip says the page mark may stay yellow", () => {
  assert.equal(HIGHLIGHT_MARK_TIP, TIP);
  assert.match(HIGHLIGHT_MARK_TIP, /The card and the list follow the tag/);
  assert.match(HIGHLIGHT_MARK_TIP, /may stay yellow/);
  assert.match(HIGHLIGHT_MARK_TIP, /Roam's reader changes it/);
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const box = buildColorPicker(stub.document, () => {}, null, { onHighlight() {} });
    const pink = box.querySelector('[aria-label="#h/pink"]');
    assert.equal(pink.getAttribute("title"), TIP);
    assert.equal(pink.getAttribute("data-tip-extra"), TIP);
  } finally {
    restore();
  }
});
