// Reader polish from the 3.7.0 live pass: bar next to the pane, labels, PDF titles, low-zoom placement, copy buttons.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { cleanPdfTitle, coverModel, pdfFileTitle, pdfTitlePlan } from "../src/model/pdf.js";
import { buildMenu } from "../src/view/menu-model.js";
import { startPlacement, PLACE_PREVIEW_MIN } from "../src/view/drag-ghost.js";
import { COPY_ICON, copyIconNudges } from "../src/view/page-chips.js";
import { placementContent } from "../src/view/parse-actions.js";
import { createReadPane } from "../src/view/read-pane.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("the board bar stays one clipped row left of the reader and More carries the hidden actions", () => {
  const css = read("../src/css/read-pane.css");
  assert.match(css, /pxd-root--read:not\(\.pxd-root--read-stack\) \.pxd-toolbar\s*\{[^}]*flex-wrap:\s*nowrap;[^}]*overflow:\s*hidden/);
  assert.match(css, /\.pxd-toolbar \.pxd-toolbar__more\s*\{[^}]*order:\s*-1/);
  assert.match(css, /\.pxd-toolbar \.pxd-toolbar__present/);
  const ids = (items) => items.map((i) => i.id);
  const open = ids(buildMenu("board-menu", { readOpen: true }));
  for (const id of ["bar-table", "bar-kanban", "bar-lens", "bar-focus", "bar-present"]) assert.ok(open.includes(id), id);
  const closed = ids(buildMenu("board-menu", {}));
  assert.equal(closed.includes("bar-present"), false);
  const board = read("../src/view/board-view.js");
  for (const id of ["bar-table", "bar-kanban", "bar-lens", "bar-focus", "bar-present"]) assert.ok(board.includes(`case "${id}"`), id);
});

test("no reader control exposes a raw key as its label", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const root = doc.createElement("div");
    root.className = "pxd-root";
    doc.body.append(root);
    const pane = createReadPane({ doc, root, storage: stub.localStorage, host: { renderBlock() {}, unmount() {} } });
    pane.open({ blockUid: "blk", cardUid: "c", title: "Paper", source: "{{[[pdf]]: https://example.test/a.pdf}}" });
    const raw = /^[a-z]+(\.[a-z-]+)+$/;
    const modes = pane.element().querySelectorAll(".pxd-read__mode");
    assert.equal(modes.length, 4);
    for (const node of modes) {
      const label = node.getAttribute("aria-label");
      assert.ok(label && !raw.test(label), `aria-label ${label}`);
      assert.ok(node.textContent && !raw.test(node.textContent));
    }
    assert.deepEqual(modes.map((n) => n.getAttribute("aria-label")), ["Read", "Read + Outline", "Show parsed text boxes", "Show the outline"]);
    for (const node of pane.element().querySelectorAll("[aria-label]")) {
      assert.equal(raw.test(node.getAttribute("aria-label")), false, node.getAttribute("aria-label"));
    }
    pane.dispose();
  } finally {
    restore();
  }
});

test("cleanPdfTitle drops junk metadata and keeps real titles", () => {
  for (const junk of ["I", "II", "iv.", "abc", "Untitled", "untitled document", "Microsoft Word - ", "Microsoft Word - A", "", null]) {
    assert.equal(cleanPdfTitle(junk), "", String(junk));
  }
  assert.equal(cleanPdfTitle("Microsoft Word - Hazard analysis.docx"), "Hazard analysis.docx");
  assert.equal(cleanPdfTitle("  Hazard   analysis "), "Hazard analysis");
  assert.equal(cleanPdfTitle("Mix"), "");
  assert.equal(cleanPdfTitle("Milk"), "Milk");
});

test("title rule: real metadata, then the first parsed heading, then the file name, then PDF", () => {
  const url = "https://firebasestorage.example/v0/b/x/o/imgs%2Fapp%2FReadwisenotes%2FEU%20regulation%202073.pdf?alt=media";
  assert.equal(pdfFileTitle(url), "EU regulation 2073");
  assert.equal(pdfFileTitle("https://firebasestorage.example/o/imgs%2Fapp%2Fg%2FAbCdEfGhIjK.pdf"), "");
  assert.equal(pdfTitlePlan({ metadataTitle: "I", parsedTitle: "Microbiological criteria", url }), "Microbiological criteria");
  assert.equal(pdfTitlePlan({ metadataTitle: "I", url }), "EU regulation 2073");
  assert.equal(pdfTitlePlan({ metadataTitle: "Real title", parsedTitle: "Heading", url }), "Real title");
  assert.equal(pdfTitlePlan({ metadataTitle: "I", url: "https://x.test/o/imgs%2Fapp%2Fg%2FAbCdEfGhIjK.pdf" }), "PDF");
  assert.equal(coverModel({ metadataTitle: "Untitled", url }).title, "EU regulation 2073");
  const board = read("../src/view/board-view.js");
  assert.match(board, /cleanPdfTitle\(pdfMeta\.title\(key\)\) \|\| parsedKnown/);
});

test("the pane header ignores a junk metadata title and uses the file name", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const root = doc.createElement("div");
    root.className = "pxd-root";
    doc.body.append(root);
    const pane = createReadPane({ doc, root, storage: stub.localStorage, host: { renderBlock() {}, unmount() {} } });
    pane.open({ blockUid: "blk", cardUid: "c", title: "I", source: "{{[[pdf]]: https://x.test/o/imgs%2Fapp%2Fg%2FEU%20regulation.pdf}}" });
    const title = () => pane.element().querySelector(".pxd-read__title").textContent;
    assert.equal(title(), "EU regulation");
    pane.setTitle("I");
    assert.equal(title(), "EU regulation");
    pane.dispose();
  } finally {
    restore();
  }
});

function placeRig() {
  const stub = createDomStub({ width: 1200, height: 800 });
  const restore = stub.install();
  const doc = globalThis.document;
  const root = doc.createElement("div");
  root.className = "pxd-root";
  doc.body.append(root);
  const pane = doc.createElement("aside");
  pane._rect = { left: 800, top: 0, width: 400, height: 800, right: 1200, bottom: 800 };
  root.append(pane);
  return { stub, restore, doc, root, pane };
}

test("click-to-place at 10% zoom: legible preview, dashed footprint at true size, drop from the footprint", () => {
  const r = placeRig();
  try {
    const placed = [];
    let t = 0;
    const p = startPlacement({
      doc: r.doc, root: r.root, pane: r.pane, pointer: { x: 400, y: 300 },
      content: { kind: "table", rows: [["a", "b"]], rowCap: 8 }, width: 900, footprint: { w: 900, h: 200 }, zoom: 0.1, blocked: [],
      onPlace: (at) => placed.push(at), now: () => t,
    });
    r.stub.dispatch(r.doc.body, "pointermove", { clientX: 400, clientY: 300 });
    t += 1000;
    r.stub.flushFrames();
    p.ghost.frame(t);
    assert.equal(p.ghost.zone(), "board");
    const { sx } = p.ghost.scale();
    assert.ok(sx >= PLACE_PREVIEW_MIN - 1e-6 || sx * 900 <= 1200 * 0.9 + 1, "content scale is the legible minimum or the viewport cap");
    assert.ok(sx > 0.1);
    assert.ok(sx * 900 <= 1200 * 0.9 + 1, "capped to the viewport");
    const foot = r.root.querySelector(".pxd-ghost-foot");
    assert.ok(foot, "footprint drawn");
    assert.equal(foot.style.width, "90.0px");
    assert.equal(foot.style.height, "20.0px");
    const drop = p.ghost.dropPoint();
    assert.equal(Math.round(drop.w), 90);
    assert.equal(Math.round(drop.h), 20);
    assert.equal(Math.round(drop.x), 400 - 45);
    assert.equal(Math.round(drop.y), 300 - 10);
    r.stub.dispatch(r.doc.body, "pointerdown", { clientX: 400, clientY: 300, button: 0 });
    assert.equal(placed.length, 1);
    assert.deepEqual(placed[0].client, { x: drop.x, y: drop.y });
    assert.equal(r.root.querySelector(".pxd-ghost-foot"), null, "footprint removed after placing");
    r.stub.flushTimers();
  } finally { r.restore(); }
});

test("click-to-place at readable zoom draws no separate footprint", () => {
  const r = placeRig();
  try {
    const p = startPlacement({
      doc: r.doc, root: r.root, pane: r.pane, pointer: { x: 400, y: 300 },
      content: { kind: "text", text: "Hi" }, width: 280, footprint: { w: 280, h: 160 }, zoom: 1, blocked: [], onPlace: () => {},
    });
    r.stub.dispatch(r.doc.body, "pointermove", { clientX: 400, clientY: 300 });
    r.stub.flushFrames();
    assert.equal(r.root.querySelector(".pxd-ghost-foot"), null);
    p.cancel();
    r.stub.flushTimers();
  } finally { r.restore(); }
});

test("the preview footprint is the size the insert uses", () => {
  const cells = (rows, cols) => Array.from({ length: rows * cols }, (_, i) => ({ r: Math.floor(i / cols), c: i % cols, rowSpan: 1, colSpan: 1, text: "w".repeat(30) }));
  const doc = {
    order: ["t1", "p1"],
    blocks: {
      t1: { id: "t1", type: "table", page: 1, rows: 4, cols: 12, cells: cells(4, 12), bbox: [0, 0, 100, 100] },
      p1: { id: "p1", type: "para", page: 1, text: "x" },
    },
  };
  const plan = placementContent(doc, ["t1"], "table");
  assert.ok(plan.width > 900, `uncapped at the real width, got ${plan.width}`);
  assert.ok(plan.height >= 80);
  const text = placementContent(doc, ["p1"], "card");
  assert.deepEqual([text.width, text.height], [280, 160]);
  assert.match(read("../src/view/parse-view.js"), /footprint: \{ w: plan\.width, h: plan\.height \}/);
});

test("copy buttons of adjacent boxes never overlap", () => {
  const page = { w: 600, h: 800 };
  const plans = [
    { id: "a", left: 10, top: 10 },
    { id: "b", left: 11, top: 11 },
    { id: "c", left: 12, top: 10.5 },
    { id: "far", left: 60, top: 60 },
  ];
  const nudges = copyIconNudges(plans, page);
  assert.equal(nudges.get("a"), 0);
  assert.ok(nudges.get("b") > 0);
  assert.equal(nudges.get("far"), 0);
  const rects = plans.map((p) => ({ id: p.id, x: (p.left / 100) * page.w, y: (p.top / 100) * page.h + nudges.get(p.id) }));
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const apart = Math.abs(rects[i].x - rects[j].x) >= COPY_ICON || Math.abs(rects[i].y - rects[j].y) >= COPY_ICON;
      assert.ok(apart, `${rects[i].id} and ${rects[j].id} overlap`);
    }
  }
});
