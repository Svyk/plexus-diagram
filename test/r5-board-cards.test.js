// Round 5 board lane: PDF cards resize and keep the size, image cards scale their picture, banners never name a PDF.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { buildBoard, worldRects } from "../src/model/board.js";
import { createItemRenderer } from "../src/view/cards.js";
import { PDF_CARD_MAX, cleanPdfTitle, coverModel } from "../src/model/pdf.js";
import { isBannerTitle } from "../src/model/title-cap.js";
import { pdfRowName } from "../src/model/pdf-ident.js";
import { pdfNameFor, setPdfNameResolver } from "../src/model/pdf-name-for.js";

afterEach(() => resetSessions());

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const PDF = "{{[[pdf]]: https://example.test/a.pdf}}";

test("a PDF card resizes bigger and the size persists in :plexus props", async () => {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({ uid: "b1", props: { plexus: { v: 2 } }, children: [{ uid: "pdf1", string: PDF, props: { plexus: { x: 10, y: 20, w: 707.9, h: 1059.4 } } }] });
  const session = acquireSession("b1", { host, linkDelay: 0 });
  await session.ready?.();
  await session.idle();
  const before = session.rects.get("pdf1");
  await session.commitRects([{ uid: "pdf1", x: before.x, y: before.y, w: 1158.9, h: 1182.6 }]);
  await session.idle();
  assert.equal(fake.props("pdf1").plexus.w, 1158.9);
  assert.equal(fake.props("pdf1").plexus.h, 1182.6);
  assert.equal(session.rects.get("pdf1").w, 1158.9);
});

test("the painted rect of a PDF card comes from the rect being painted, not the renderer's previous one", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const root = doc.createElement("div");
    root.className = "pxd-root";
    const itemsLayer = doc.createElement("div");
    const sectionsLayer = doc.createElement("div");
    root.append(sectionsLayer, itemsLayer);
    doc.body.append(root);
    const r = createItemRenderer({
      doc,
      host: { renderString(node, string) { node.textContent = string; }, renderBlock() {}, unmount() {}, blockString: () => "", pdfCover: () => ({ title: "Paper", count: 0 }), pullTree: () => [] },
      session: {}, itemsLayer, sectionsLayer,
      timers: { idle: () => () => {}, later: () => () => {} },
    });
    const board = buildBoard({
      ":block/uid": "boardfix1", ":block/string": "{{[[diagram]]:Fix}}", ":block/props": { ":plexus": { ":v": 2 } },
      ":block/children": [{ ":block/uid": "pdfcard01", ":block/string": PDF, ":block/order": 0, ":block/props": { ":plexus": { ":x": 0, ":y": 0, ":w": 280, ":h": 160 } }, ":block/children": [] }],
    });
    r.sync({ board, rects: worldRects(board), structural: true });
    const grown = { x: 0, y: 0, w: 600, h: 400 };
    assert.deepEqual(r.drawnRect("pdfcard01", grown), grown, "a grown rect is not snapped back to the old one");
    assert.deepEqual(r.drawnRect("pdfcard01"), { x: 0, y: 0, w: 280, h: 160 });
    assert.equal(r.drawnRect("pdfcard01", { x: 0, y: 0, w: 9000, h: 400 }).w, PDF_CARD_MAX);
  } finally { restore(); }
  const view = read("../src/view/board-view.js");
  assert.match(view, /itemsR\.drawnRect\?\.\(item\.uid, own\)/);
});

test("image cards fill the card body and keep the picture contained and centred", () => {
  const css = read("../src/extension.css");
  const block = (needle) => {
    const at = css.indexOf(needle);
    assert.ok(at >= 0, needle);
    return css.slice(at, css.indexOf("}", at));
  };
  assert.match(block(".pxd-root .pxd-item.pxd-item--image > .pxd-item__body > .pxd-item__media .rm-inline-img {"), /width:\s*100%[^}]*height:\s*100%[^}]*max-height:\s*none[^}]*object-fit:\s*contain/);
  assert.match(block(".pxd-root .pxd-item.pxd-item--image > .pxd-item__body > .pxd-item__media :is(.rm-inline-img__resize, .react-resizable) {"), /width:\s*100%\s*!important/);
  assert.match(css, /pxd-item--image > \.pxd-item__body > \.pxd-item__media,[^{]*\{\s*height:\s*100%/);
  // The 320px cap stays for any other media body.
  assert.match(block(".pxd-item__media .rm-inline-img {"), /max-height:\s*var\(--pxd-media-max, 320px\)/);
});

test("the page flipper canvas fills the card at any zoom", () => {
  const css = read("../src/css/pdf-cover.css");
  const at = css.indexOf(".pxd-root .pxd-pdf-flip canvas {");
  assert.match(css.slice(at, css.indexOf("}", at)), /width:\s*100%\s*!important[^}]*height:\s*100%\s*!important/);
});

test("banners are not titles: letter-spaced words, short all-caps lines, article labels", () => {
  for (const banner of ["MA J O R A R T I C L E", "M A J O R  A R T I C L E", "MAJOR ARTICLE", "ORIGINAL RESEARCH", "Research Article", "Brief Report", "RESEARCH ARTICLE", "Untitled"]) {
    assert.equal(cleanPdfTitle(banner), "", banner);
  }
  assert.equal(isBannerTitle("MA J O R A R T I C L E"), true);
  for (const real of [
    "A Cumulative Spore Killing Approach: Synergistic Sporicidal Activity of Dilute Peracetic Acid and Ethanol",
    "Hand hygiene study", "Paper", "HACCP Plan for Powder Blending", "SQF Code Edition 9", "Report on batch records",
  ]) assert.equal(isBannerTitle(real), false, real);
  assert.equal(cleanPdfTitle("Microsoft Word - Sanitation SOP rev 4"), "Sanitation SOP rev 4");
});

test("a banner loses to the first-page title, then to the real parsed title, and never names the card", () => {
  const spore = "A Cumulative Spore Killing Approach: Synergistic Sporicidal Activity of Dilute Peracetic Acid and Ethanol";
  assert.equal(coverModel({ metadataTitle: "MA J O R A R T I C L E", identTitle: spore, url: "https://x.test/rISmpBtsk7.pdf" }).title, spore);
  assert.equal(coverModel({ title: "MA J O R A R T I C L E", parsedTitle: "Parsed real title", url: "https://x.test/a.pdf" }).title, "Parsed real title");
  assert.equal(coverModel({ title: "MAJOR ARTICLE", url: "https://x.test/Hand%20hygiene%20study.pdf" }).title, "Hand hygiene study");
  assert.equal(coverModel({ alias: "My own name", identTitle: spore, url: "https://x.test/a.pdf" }).title, "My own name");
  assert.equal(pdfRowName({ parsedTitle: "MA J O R A R T I C L E", coverTitle: "MAJOR ARTICLE", ident: { title: spore } }).title, spore);
  assert.equal(pdfRowName({ ownTitle: "Spore paper", parsedTitle: "MA J O R A R T I C L E", ident: { title: spore } }).title, "Spore paper");
});

test("pdfNameFor answers from the registered caches and is empty when nothing is known", () => {
  assert.equal(pdfNameFor("pdfcard01"), "");
  const off = setPdfNameResolver((key) => (key === "pdfcard01" ? "Spore paper" : key === "gone" ? "PDF" : ""));
  try {
    assert.equal(pdfNameFor("pdfcard01"), "Spore paper");
    assert.equal(pdfNameFor("gone"), "");
    assert.equal(pdfNameFor("other"), "");
    assert.equal(pdfNameFor(""), "");
  } finally { off(); }
  assert.equal(pdfNameFor("pdfcard01"), "");
  const boom = setPdfNameResolver(() => { throw new Error("cache"); });
  try { assert.equal(pdfNameFor("x"), ""); } finally { boom(); }
});
