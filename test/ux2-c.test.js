// Lane C. A copied figure is the picture plus its caption, the source line stays a quiet chip,
// and a pin jump turns Show parsed on and flashes that part.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

import { figureCardMarkdown, isSourceAttrString, matchParsedBlock, pageFracFromBbox, planCopiedSource } from "../src/model/pdf-pin.js";
import { createPageChips } from "../src/view/page-chips.js";
import { applyPdfReaderDark, normalizePdfReaderDark, PDF_READER_DARK_CLASS, pdfReaderDarkOn } from "../src/view/pdf-reader-dark.js";
import { createSettingsPanel, settingsDefaults } from "../src/settings.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const CAPTION = "Fig. 1 | Data characterization, preprocessing pipeline, and data analysis.";

function figureDoc() {
  const page = { n: 3, w: 100, h: 200, rotation: 0 };
  const figure = { id: "f1", type: "figure", page: 3, bbox: [10, 20, 60, 80], image: { url: "https://example.test/fig.png" }, caption: "c1" };
  const text = { id: "p1", type: "para", page: 3, bbox: [10, 90, 90, 120], text: "Osmotic water flow" };
  const table = { id: "t1", type: "table", page: 3, bbox: [10, 130, 90, 180], rows: 2, cols: 2 };
  const caption = { id: "c1", type: "caption", for: "f1", text: CAPTION, page: 3 };
  return {
    page,
    figure,
    text,
    table,
    doc: { blocks: { f1: figure, p1: text, t1: table, c1: caption }, order: ["f1", "c1", "p1", "t1"], pages: [page] },
  };
}

test("a figure copy is the image and the caption on one card, and the source line is quiet", () => {
  const { figure, doc } = figureDoc();
  const markdown = figureCardMarkdown(figure, doc);
  assert.match(markdown, /^!\[Fig\. 1 \| Data characterization/);
  assert.match(markdown, /\]\(https:\/\/example\.test\/fig\.png\) /);
  assert.ok(markdown.endsWith(CAPTION));
  assert.equal(markdown.includes("\n"), false);
  const planned = planCopiedSource({ markdown, source: "pinuid01" });
  assert.equal(planned.sourceUid, "pinuid01");
  assert.equal((planned.markdown.match(/^- /gm) || []).length, 1);
  assert.match(planned.markdown, /!\[/);
  assert.match(planned.markdown, /Data characterization/);
  const bare = { ...figure, image: {} };
  assert.equal(figureCardMarkdown(bare, doc), CAPTION);
  assert.equal(isSourceAttrString("Source:: ((pinuid01))"), true);
  assert.equal(isSourceAttrString("Fig. 1 | Data characterization"), false);
  const cards = readFileSync(new URL("../src/view/cards.js", import.meta.url), "utf8");
  assert.match(cards, /isSourceAttrString/);
  const menu = readFileSync(new URL("../src/view/parse-view.js", import.meta.url), "utf8");
  assert.match(menu, /figureCardMarkdown\(live, parsed\)/);
  assert.match(menu, /flashPart\(/);
  const pane = readFileSync(new URL("../src/view/read-pane.js", import.meta.url), "utf8");
  assert.match(pane, /flashPart\(\{ page: next\.page, frac \}\)/);
});

test("a pin frac matches the figure, the text, and the table on that page", () => {
  const { doc, page, figure, text, table } = figureDoc();
  assert.equal(matchParsedBlock(doc, { page: 3, frac: pageFracFromBbox(figure.bbox, page) }).id, "f1");
  assert.equal(matchParsedBlock(doc, { page: 3, frac: pageFracFromBbox(text.bbox, page) }).id, "p1");
  assert.equal(matchParsedBlock(doc, { page: 3, frac: pageFracFromBbox(table.bbox, page) }).id, "t1");
  assert.equal(matchParsedBlock(doc, { page: 9, frac: [0, 0, 1, 1] }), null);
});

test("show parsed flashes the matched part and scrolls it into view", () => {
  const { doc, page, figure } = figureDoc();
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const scroller = globalThis.document.createElement("div");
    scroller.className = "PdfHighlighter";
    scroller.scrollTop = 0;
    scroller._rect = { left: 0, top: 0, width: 100, height: 200, right: 100, bottom: 200 };
    const pageEl = globalThis.document.createElement("div");
    pageEl.className = "page";
    pageEl.setAttribute("data-page-number", "3");
    pageEl.setAttribute("data-loaded", "true");
    pageEl._rect = { left: 0, top: 400, width: 100, height: 200, right: 100, bottom: 600 };
    scroller.append(pageEl);
    globalThis.document.body.append(scroller);
    const storage = { getItem: () => "0", setItem() {} };
    const chips = createPageChips({
      doc: globalThis.document,
      getParsed: () => doc,
      pageEl: (n) => (n === 3 ? pageEl : null),
      pageOf: () => page,
      storage,
    });
    chips.setShown(true);
    const box = pageEl.querySelector('[data-block="f1"]');
    assert.ok(box, "the figure outline is on the page");
    const ok = chips.flash("f1");
    assert.equal(ok, true);
    assert.equal(box.classList.contains("pxd-parsed-box--flash"), true);
    assert.ok(scroller.scrollTop > 0);
    assert.equal(matchParsedBlock(doc, { page: 3, frac: pageFracFromBbox(figure.bbox, page) }).id, "f1");
    const css = readFileSync(new URL("../src/css/page-chips.css", import.meta.url), "utf8");
    assert.match(css, /pxd-parsed-box--flash/);
    assert.match(css, /@keyframes pxd-parsed-flash/);
    assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/);
    chips.dispose();
  } finally {
    restore();
  }
});

test("PDF dark mode follows Roam, inverts native page canvases, and leaves highlights alone", () => {
  assert.equal(normalizePdfReaderDark(undefined), "follow");
  assert.equal(normalizePdfReaderDark("ON"), "on");
  assert.equal(normalizePdfReaderDark("nope"), "follow");
  const dark = {
    documentElement: { className: "bp3-dark", classList: { contains: (name) => name === "bp3-dark" } },
    body: { className: "", classList: { contains: () => false } },
  };
  const light = {
    documentElement: { className: "", classList: { contains: () => false } },
    body: { className: "", classList: { contains: () => false } },
  };
  assert.equal(pdfReaderDarkOn("follow", dark, ""), true);
  assert.equal(pdfReaderDarkOn("follow", light, "rgb(255, 255, 255)"), false);
  assert.equal(pdfReaderDarkOn("off", dark, ""), false);
  assert.equal(pdfReaderDarkOn("on", light, "rgb(255, 255, 255)"), true);
  const src = readFileSync(new URL("../src/view/pdf-reader-dark.js", import.meta.url), "utf8");
  assert.equal(src.includes("prefers-color-scheme"), false);
  const css = readFileSync(new URL("../src/css/read-pane.css", import.meta.url), "utf8");
  const start = css.indexOf("html.pxd-pdf-reader-dark .rm-pdf-container .page > canvas");
  assert.ok(start > 0);
  const rule = css.slice(start, css.indexOf("}", start));
  assert.match(rule, /filter:\s*invert\(1\) hue-rotate\(180deg\)/);
  assert.equal(/img|Highlight|pxd-parsed-box|textLayer/.test(rule), false);
  assert.equal(settingsDefaults()["pdf-reader-dark"], "follow");
  const row = createSettingsPanel().settings.find((entry) => entry.id === "pdf-reader-dark");
  assert.equal(row.name, "PDF dark mode");
  assert.deepEqual(row.action.items, ["off", "follow", "on"]);
  const groups = [];
  let current = null;
  const members = {};
  for (const entry of createSettingsPanel().settings) {
    if (String(entry.id).startsWith("group-")) {
      current = entry.name;
      groups.push(current);
      members[current] = [];
    } else if (current && entry.id !== "reset-plexus-settings") members[current].push(entry.id);
  }
  assert.equal(groups[1], "PDF reader");
  assert.deepEqual(members["PDF reader"], ["pdf-reader-dark"]);
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  assert.match(readme, /\| PDF reader \| PDF dark mode \|/);
  const html = {
    names: new Set(),
    classList: null,
  };
  html.classList = {
    toggle(name, on) { if (on) html.names.add(name); else html.names.delete(name); },
    contains(name) { return html.names.has(name); },
  };
  applyPdfReaderDark({ documentElement: html }, true);
  assert.equal(html.classList.contains(PDF_READER_DARK_CLASS), true);
  applyPdfReaderDark({ documentElement: html }, false);
  assert.equal(html.classList.contains(PDF_READER_DARK_CLASS), false);
  const board = readFileSync(new URL("../src/view/board-view.js", import.meta.url), "utf8");
  assert.match(board, /pdfReaderDarkOn\(readSetting\("pdf-reader-dark"\)/);
  const feature = readFileSync(new URL("../src/feature.js", import.meta.url), "utf8");
  assert.match(feature, /applyPdfReaderDark\(/);
});
