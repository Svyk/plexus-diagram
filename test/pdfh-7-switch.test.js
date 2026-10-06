// PDFH-7. One reader, cover titles, list keys on the pane, no new command.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { coverModel, pdfMacroUrl, readerRule } from "../src/model/pdf.js";
import { createReadPane } from "../src/view/read-pane.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const SELF = "{{[[pdf]]: https://example.test/Self%20paper.pdf}}";
const REF = "{{[[pdf]]: https://example.test/Ref%20paper.pdf}}";

function fiberAt(highlight) {
  return { return: { memoizedProps: { value: { highlight } } } };
}

function settle(stub) {
  for (let i = 0; i < 6; i += 1) {
    if (!stub.flushTimers()) break;
  }
}

function pdfCard(uid, blockUid, string) {
  return { uid, kind: "pdf", string, blockUid };
}

test("the switcher lists pdf covers and choosing one leaves a single reader", () => {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const root = doc.createElement("div");
  root.className = "pxd-root";
  doc.body.append(root);
  const pdfs = [
    pdfCard("pdfself01", "blockself", SELF),
    pdfCard("pdfref001", "blockref01", REF),
  ];
  const cards = [...pdfs, { uid: "notpdf001", kind: "note", string: "hello", blockUid: "notablock" }];
  const rendered = [];
  const switched = [];
  const writes = [];
  let pane;
  const host = {
    renderBlock(node, uid) {
      rendered.push(uid);
      const box = doc.createElement("div");
      box.className = "rm-pdf-container";
      const input = doc.createElement("input");
      input.value = "1";
      box.append(input);
      node.append(box);
    },
    unmount(node) { node?.replaceChildren?.(); },
    pdfHighlightTree() { return []; },
    createBlock(...args) { writes.push(args); },
  };
  pane = createReadPane({
    doc,
    root,
    host,
    cards: () => cards,
    onSwitch(uid) {
      switched.push(uid);
      const card = pdfs.find((item) => item.uid === uid);
      const rule = readerRule(pane.cardUid(), uid);
      assert.equal(rule.open, uid);
      pane.open({
        cardUid: card.uid,
        blockUid: card.blockUid,
        source: card.string,
        pageUid: "pagepdf01",
        title: coverModel({ url: pdfMacroUrl(card.string) }).title,
      });
    },
  });
  try {
    pane.open({
      cardUid: "pdfself01",
      blockUid: "blockself",
      source: SELF,
      pageUid: "pagepdf01",
      title: coverModel({ url: pdfMacroUrl(SELF) }).title,
    });
    const switcher = root.querySelector(".pxd-read__switch");
    const labels = [...switcher.querySelectorAll("option")].map((node) => node.textContent);
    assert.deepEqual(labels, [
      coverModel({ url: pdfMacroUrl(SELF) }).title,
      coverModel({ url: pdfMacroUrl(REF) }).title,
    ]);
    assert.deepEqual(labels, ["Self paper", "Ref paper"]);
    assert.equal(root.querySelectorAll(".rm-pdf-container").length, 1);

    switcher.value = "pdfref001";
    stub.dispatch(switcher, "change");
    assert.deepEqual(switched, ["pdfref001"]);
    assert.equal(rendered.at(-1), "blockref01");
    assert.equal(root.querySelectorAll(".rm-pdf-container").length, 1);
    assert.equal(pane.cardUid(), "pdfref001");
    assert.equal(writes.length, 0);

    switcher.value = "pdfref001";
    stub.dispatch(switcher, "change");
    assert.deepEqual(switched, ["pdfref001"]);
    assert.equal(root.querySelectorAll(".rm-pdf-container").length, 1);
    pane.dispose();
  } finally {
    restore();
  }
});

test("list keys live on the pane: arrows, Enter locates, the reader and Escape add nothing", () => {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const root = doc.createElement("div");
  root.className = "pxd-root";
  doc.body.append(root);
  const writes = [];
  const noted = [];
  const located = [];
  const early = { id: "hlrow0001", type: "text", color: "green", content: { text: "alpha passage" } };
  const late = { id: "hlrow0002", type: "text", color: "yellow", content: { text: "beta passage" } };
  const tree = [{
    uid: "hlrow0002",
    string: "beta passage #h/yellow",
    props: { ":pdf-highlight": { ":type": "text", ":position": { ":boundingRect": { ":pageNumber": 5 } } } },
    children: [],
  }, {
    uid: "hlrow0001",
    string: "alpha passage #h/green",
    props: { ":pdf-highlight": { ":type": "text", ":position": { ":boundingRect": { ":pageNumber": 2 } } } },
    children: [],
  }];
  const host = {
    renderBlock(node) {
      const box = doc.createElement("div");
      box.className = "rm-pdf-container";
      const input = doc.createElement("input");
      input.value = "1";
      const scroller = doc.createElement("div");
      scroller.className = "PdfHighlighter";
      scroller["__reactFiber$ctx"] = {
        memoizedProps: { value: { scrollToHighlight(hl) { located.push(hl); } } },
      };
      const page = doc.createElement("div");
      page.className = "page";
      const first = doc.createElement("div");
      first.className = "TextHighlight__part";
      first["__reactFiber$a"] = fiberAt(early);
      const second = doc.createElement("div");
      second.className = "TextHighlight__part";
      second["__reactFiber$b"] = fiberAt(late);
      page.append(first, second);
      box.append(input, scroller, page);
      node.append(box);
    },
    pdfHighlightTree() { return tree; },
    createBlock(...args) { writes.push(["create", ...args]); },
    updateBlock(...args) { writes.push(["update", ...args]); },
  };
  const pane = createReadPane({
    doc,
    root,
    host,
    onNote(row) { noted.push(row.uid); },
  });
  try {
    pane.open({ blockUid: "pdfblock1", cardUid: "pdfcard01", title: "Paper", pageUid: "pagepdf01" });
    const paneEl = root.querySelector(".pxd-read");
    const keys = [...stub.listeners].filter((entry) => entry.type === "keydown");
    assert.equal(keys.length, 1);
    assert.equal(keys[0].target, paneEl);
    assert.equal(keys[0].target === stub.document, false);
    assert.equal(keys[0].target === stub.window, false);

    const list = root.querySelector(".pxd-read__list");
    const selected = () => root.querySelector(".pxd-read__row--on")?.getAttribute("data-uid") || "";
    const down = stub.dispatch(list, "keydown", { key: "ArrowDown" });
    assert.equal(down.defaultPrevented, true);
    assert.equal(selected(), "hlrow0001");
    stub.dispatch(list, "keydown", { key: "ArrowDown" });
    assert.equal(selected(), "hlrow0002");
    const up = stub.dispatch(list, "keydown", { key: "ArrowUp" });
    assert.equal(up.defaultPrevented, true);
    assert.equal(selected(), "hlrow0001");

    const field = root.querySelector(".rm-pdf-container input");
    const page = root.querySelector(".rm-pdf-container .page");
    const inside = stub.dispatch(page, "keydown", { key: "ArrowDown" });
    assert.equal(inside.defaultPrevented, false);
    assert.equal(selected(), "hlrow0001");
    const insideEnter = stub.dispatch(page, "keydown", { key: "Enter" });
    assert.equal(insideEnter.defaultPrevented, false);
    assert.equal(field.value, "1");
    const insideEsc = stub.dispatch(page, "keydown", { key: "Escape" });
    assert.equal(insideEsc.defaultPrevented, false);
    assert.equal(pane.isOpen(), true);
    assert.equal(noted.length, 0);

    const find = root.querySelector(".pxd-read__find");
    const typed = stub.dispatch(find, "keydown", { key: "ArrowDown" });
    assert.equal(typed.defaultPrevented, false);
    assert.equal(selected(), "hlrow0001");

    const meta = stub.dispatch(list, "keydown", { key: "f", metaKey: true });
    const ctrl = stub.dispatch(list, "keydown", { key: "f", ctrlKey: true });
    assert.equal(meta.defaultPrevented, false);
    assert.equal(ctrl.defaultPrevented, false);

    const entered = stub.dispatch(list, "keydown", { key: "Enter" });
    assert.equal(entered.defaultPrevented, true);
    assert.equal(field.value, "2");
    assert.equal(located.length, 0);
    settle(stub);
    assert.equal(located.length, 1);
    assert.equal(located[0], early);
    assert.equal(writes.length, 0);
    assert.equal(noted.length, 0);

    stub.dispatch(list, "keydown", { key: "Escape" });
    assert.equal(noted.length, 0);
    assert.equal(writes.length, 0);
    assert.equal(pane.isOpen(), false);

    const paneSrc = readFileSync(new URL("../src/view/read-pane.js", import.meta.url), "utf8");
    const featureSrc = readFileSync(new URL("../src/feature.js", import.meta.url), "utf8");
    assert.equal(paneSrc.includes("commandPalette"), false);
    assert.equal(paneSrc.includes("addCommand"), false);
    assert.equal(featureSrc.split("ui.commandPalette").length - 1, 2);
  } finally {
    restore();
  }
});
