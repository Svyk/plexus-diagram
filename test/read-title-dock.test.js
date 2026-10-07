// The pane header names a PDF by its parsed title, and the dock stays left of the open pane.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parsedDocTitle } from "../src/model/pdf.js";
import { createParseView } from "../src/view/parse-view.js";
import { createReadPane } from "../src/view/read-pane.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("parsedDocTitle prefers title, then the first level-1 heading, never a storage path", () => {
  assert.equal(parsedDocTitle({ title: "  Risk factors  " }), "Risk factors");
  const blocks = {
    a: { id: "a", type: "heading", level: 2, text: "Abstract" },
    b: { id: "b", type: "heading", level: 1, text: "Hazard   analysis\nof  powders" },
  };
  assert.equal(parsedDocTitle({ title: "", order: ["a", "b"], blocks }), "Hazard analysis of powders");
  assert.equal(parsedDocTitle({ title: null, order: ["a"], blocks }), "");
  assert.equal(parsedDocTitle({ title: "imgs/app/graph/abc123XYZ.pdf", order: ["b"], blocks }), "Hazard analysis of powders");
  assert.equal(parsedDocTitle(null), "");
  assert.equal(parsedDocTitle({}), "");
});

test("parsedDocTitle falls back to a table caption, then a short first-page paragraph", () => {
  const blocks = {
    p2: { id: "p2", type: "para", page: 2, text: "Later page text" },
    t1: { id: "t1", type: "table", page: 1, caption: "c1" },
    c1: { id: "c1", type: "caption", page: 1, text: "Table 1.  Cases\nby state" },
    p1: { id: "p1", type: "para", page: 1, text: "NOTIFIABLE DISEASES - Summary of reported   cases" },
    s1: { id: "s1", type: "scan", page: 1 },
  };
  assert.equal(parsedDocTitle({ order: ["s1", "p1", "t1", "c1"], blocks }), "Table 1. Cases by state");
  assert.equal(parsedDocTitle({ order: ["s1", "p1"], blocks }), "NOTIFIABLE DISEASES - Summary of reported cases");
  assert.equal(parsedDocTitle({ order: ["p2"], blocks }), "");
  const long = { id: "l", type: "para", page: 1, text: "x ".repeat(100) };
  assert.equal(parsedDocTitle({ order: ["l"], blocks: { l: long } }), "");
});

test("the parse view reports the document title when it renders a parse", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const seen = [];
    const view = createParseView({ doc: stub.document, onTitle: (t) => seen.push(t) });
    stub.document.body.append(view.element());
    view.showDoc({
      schema: "pxd-parse/1", engine: "builtin", sha256: "abc", optsHash: "h", pageCount: 1,
      pages: [{ n: 1, w: 100, h: 200, rotation: 0, kind: "text" }],
      title: "",
      order: ["h1"],
      blocks: { h1: { id: "h1", type: "heading", level: 1, page: 1, text: "Elsevier risk paper", bbox: [0, 0, 10, 10], confidence: 0.9 } },
    });
    assert.equal(seen.at(-1), "Elsevier risk paper");
  } finally {
    restore();
  }
});

test("the pane header falls back to PDF only when nothing names the document", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const root = doc.createElement("div");
    root.className = "pxd-root";
    doc.body.append(root);
    const pane = createReadPane({ doc, root, storage: stub.localStorage, host: { renderBlock() {}, unmount() {} } });
    pane.open({ blockUid: "blk", cardUid: "c", title: "", source: "{{[[pdf]]: https://example.test/a.pdf}}" });
    const title = () => pane.element().querySelector(".pxd-read__title").textContent;
    assert.equal(title(), "PDF");
    pane.setTitle("Named");
    assert.equal(title(), "Named");
    pane.setTitle("PDF");
    assert.equal(title(), "PDF");
    pane.dispose();
  } finally {
    restore();
  }
});

test("the pane and the board wire the parsed title to the header and the card", () => {
  const pane = read("../src/view/read-pane.js");
  assert.match(pane, /shownTitle = \(\) => realTitle\(current\.title\) \|\| parsedTitle \|\| "PDF"/);
  assert.match(pane, /onTitle: noteParsedTitle/);
  const board = read("../src/view/board-view.js");
  assert.match(board, /onParsedTitle: \(url, title\)/);
  assert.match(board, /pdfMeta\.title\(key\) \|\| parsedKnown/);
});

test("the dock shrinks, loses labels and scrolls instead of running under the pane", () => {
  const css = read("../src/css/read-pane.css");
  assert.match(css, /\.pxd-root\.pxd-root--read \.pxd-palette > \*\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;[^}]*overflow-x:\s*auto/);
  assert.match(css, /\.pxd-root\.pxd-root--read:not\(\.pxd-root--read-stack\) \.pxd-palette\s*\{[^}]*justify-content:\s*flex-start/);
  assert.match(css, /\.pxd-palette > \*\s*\{[^}]*margin-inline:\s*auto/);
  assert.match(css, /pxd-root--dock-labels\.pxd-root--read \.pxd-dock__label\s*\{[^}]*display:\s*none/);
  assert.match(css, /\.pxd-root\.pxd-root--read:not\(\.pxd-root--read-stack\) \.pxd-palette\s*\{[^}]*right:\s*calc\(var\(--pxd-read-w/);
});
