import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createPanel } from "../src/view/panel.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const timers = { later: () => () => {}, frame: () => () => {} };

function setup({ on = {}, host = {} } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const root = stub.document.createElement("div");
  root.className = "pxd-root";
  stub.document.body.append(root);
  const panel = createPanel({ doc: stub.document, root, host, timers, on });
  return { stub, restore, root, panel };
}

const q = (root, sel) => root.querySelector(sel);
const search = async (f, text) => {
  const input = q(f.root, ".pxd-panel__input");
  input.value = text;
  f.stub.dispatch(input, "keydown", { key: "Enter" });
  await tick(5);
};

const PART = {
  kind: "paragraph", page: 4, text: "brain age in the sample", docTitle: "Plan",
  sha256: "abc", engine: "builtin", optsHash: "oh", blockId: "p1", pdfUid: "pdf1", url: "https://x/plan.pdf",
};
const HIT = {
  hash: "other", url: "https://x/notes.pdf", pdfUid: "pdf2", title: "Notes", page: 3,
  text: "plasticity of the brain", snippet: { before: "…", hit: "brain", after: " plasticity" },
  frac: [0.2, 0.3, 0.4, 0.05], thumb: "https://cdn.example/p3.png",
};
const DUP = { ...HIT, hash: "abc", url: "https://x/plan.pdf", title: "Plan", thumb: "", page: 4 };
const IMG = { uid: "u1", string: "![chart](https://x.test/chart.png)", pageTitle: "Notes", palette: ["#e02020"], snippet: "a brain chart" };

test("search groups cards, pdf text, and images, with a marked snippet, page chip, and thumb", async (t) => {
  const pdfCalls = [];
  const opened = [];
  const f = setup({
    on: {
      searchParts: async () => [PART],
      searchImages: async () => ({ images: [IMG], figures: [] }),
      searchPdfText: (query, limit) => { pdfCalls.push([query, limit]); return [HIT, DUP]; },
      openPdfHit: (hit) => { opened.push(hit); return true; },
      openPart: (part) => { opened.push(part); return true; },
    },
    host: { librarySearch: () => ({ rows: [{ string: "[[Aging]]", text: "Aging", kind: "page", label: "page" }], queries: [] }) },
  });
  t.after(f.restore);
  q(f.root, ".pxd-panel__pages").value = "p. 3-8";
  await search(f, "brain");
  assert.deepEqual(pdfCalls[0][0], { text: "brain", pages: "p. 3-8" });
  assert.deepEqual([...f.root.querySelectorAll(".pxd-panel__group")].map((n) => n.textContent), ["Cards", "PDF text", "Images"]);
  assert.equal(f.root.querySelectorAll(".pxd-panel__row").length, 4);
  assert.equal(f.root.querySelectorAll(".pxd-panel__row--pdftext").length, 1);
  const pdfRow = q(f.root, ".pxd-panel__row--pdftext");
  assert.equal(q(pdfRow, ".pxd-panel__mark").textContent, "brain");
  assert.equal(q(pdfRow, ".pxd-panel__page-chip").textContent, "p. 3");
  assert.equal(q(pdfRow, ".pxd-panel__thumb").getAttribute("src"), "https://cdn.example/p3.png");
  assert.equal(q(f.root, ".pxd-panel__row--part .pxd-panel__page-chip").textContent, "p. 4");
  assert.equal(q(f.root, ".pxd-panel__row--image .pxd-panel__mark").textContent, "brain");
  f.stub.dispatch(q(pdfRow, ".pxd-panel__page-chip"), "click");
  assert.equal(opened[0], HIT);
  f.stub.dispatch(q(f.root, ".pxd-panel__row--part .pxd-panel__page-chip"), "click");
  assert.equal(opened[1], PART);
});

test("a parsed paragraph hides only that page of the same file", async (t) => {
  const same = { ...HIT, hash: "abc", url: "https://x/plan.pdf", page: 4, title: "Plan", thumb: "" };
  const other = { ...HIT, hash: "abc", url: "https://x/plan.pdf", page: 9, title: "Plan", thumb: "" };
  const f = setup({
    on: {
      searchParts: async () => [PART],
      searchPdfText: () => [same, other],
    },
  });
  t.after(f.restore);
  await search(f, "brain");
  const rows = [...f.root.querySelectorAll(".pxd-panel__row--pdftext")];
  assert.equal(rows.length, 1);
  assert.equal(q(rows[0], ".pxd-panel__page-chip").textContent, "p. 9");
});

test("arrow keys move the active row and Enter opens it; Enter with no selection still searches", async (t) => {
  const added = [];
  let pdfCalls = 0;
  const f = setup({
    on: {
      searchParts: async () => [],
      searchPdfText: () => { pdfCalls += 1; return []; },
      addBeside: (s) => added.push(s),
    },
    host: { librarySearch: () => ({ rows: [{ string: "[[Aging]]", text: "Aging", kind: "page", label: "page" }], queries: [] }) },
  });
  t.after(f.restore);
  const input = q(f.root, ".pxd-panel__input");
  input.value = "aging";
  f.stub.dispatch(input, "keydown", { key: "Enter" });
  await tick(5);
  assert.equal(pdfCalls, 1);
  assert.equal(added.length, 0);
  f.stub.dispatch(input, "keydown", { key: "ArrowDown" });
  const row = q(f.root, ".pxd-panel__row--active");
  assert.equal(row?.getAttribute("aria-selected"), "true");
  assert.equal(row.dataset.string, "[[Aging]]");
  f.stub.dispatch(input, "keydown", { key: "Enter" });
  await tick(5);
  assert.deepEqual(added, ["[[Aging]]"]);
  assert.equal(pdfCalls, 1);
});

test("a PDF-only type filter still shows parsed page text", async (t) => {
  const partCalls = [];
  let imageCalls = 0;
  const f = setup({
    on: {
      loadTypes: () => ["pdf"],
      searchParts: async (query) => {
        partCalls.push(query);
        return [{
          kind: "paragraph", page: 2, text: "Zone 3 floor drains", docTitle: "QA Technical Report",
          sha256: "rep", engine: "builtin", optsHash: "oh", blockId: "d1", pdfUid: "pdf1", url: "https://x/report.pdf",
        }];
      },
      searchImages: async () => { imageCalls += 1; return { images: [], figures: [] }; },
      searchPdfText: () => [],
    },
    host: { librarySearch: () => ({ rows: [{ string: "{{pdf: https://x/report.pdf}}", text: "QA Technical Report", kind: "pdf", label: "pdf", url: "https://x/report.pdf" }], queries: [] }) },
  });
  t.after(f.restore);
  assert.equal(q(f.root, ".pxd-panel__type-btn").textContent, "1 type");
  await search(f, "drains");
  assert.equal(partCalls.length, 1);
  assert.equal(partCalls[0].text, "drains");
  assert.ok(partCalls[0].kinds.includes("paragraph"));
  assert.equal(partCalls[0].kinds.includes("figure"), false);
  assert.equal(imageCalls, 0);
  assert.deepEqual([...f.root.querySelectorAll(".pxd-panel__group")].map((n) => n.textContent), ["Cards", "PDF text"]);
  const row = q(f.root, ".pxd-panel__row--part");
  assert.equal(q(row, ".pxd-panel__mark").textContent, "drains");
  assert.equal(q(row, ".pxd-panel__page-chip").textContent, "p. 2");
});

test("a pages-only type filter does not ask for PDF text", async (t) => {
  let partCalls = 0;
  let pdfCalls = 0;
  const f = setup({
    on: {
      loadTypes: () => ["page"],
      searchParts: async () => { partCalls += 1; return []; },
      searchPdfText: () => { pdfCalls += 1; return []; },
    },
    host: { librarySearch: () => ({ rows: [{ string: "[[Aging]]", text: "Aging", kind: "page", label: "page" }], queries: [] }) },
  });
  t.after(f.restore);
  await search(f, "drains");
  assert.equal(partCalls, 0);
  assert.equal(pdfCalls, 0);
  assert.equal(q(f.root, ".pxd-panel__group")?.textContent, "Cards");
});

test("tag and day filters do not ask the pdf text index", async (t) => {
  let pdfCalls = 0;
  const f = setup({
    on: { searchPdfText: () => { pdfCalls += 1; return []; }, searchParts: async () => [] },
    host: { librarySearch: () => ({ rows: [], queries: [] }) },
  });
  t.after(f.restore);
  q(f.root, ".pxd-panel__tag").value = "#aging";
  await search(f, "brain");
  assert.equal(pdfCalls, 0);
  q(f.root, ".pxd-panel__tag").value = "";
  q(f.root, ".pxd-panel__days").value = "7";
  await search(f, "brain");
  assert.equal(pdfCalls, 0);
});

test("tag, days, pages, and Meaning sit on a second filter row, styled with the dark tokens", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const root = stub.document.createElement("div");
    root.className = "pxd-root";
    stub.document.body.append(root);
    createPanel({ doc: stub.document, root, host: {}, timers, on: { semantic: { enabled: () => true } } });
    const row = root.querySelector(".pxd-panel__filters-row");
    assert.ok(row);
    for (const sel of [".pxd-panel__tag", ".pxd-panel__days", ".pxd-panel__pages", ".pxd-panel__meaning"]) {
      assert.equal(root.querySelector(sel).parentElement, row);
    }
  } finally {
    restore();
  }
  const css = readFileSync(new URL("../src/css/panel-search.css", import.meta.url), "utf8");
  assert.match(css, /\.pxd-panel__group[\s\S]*var\(--pxd-muted\)/);
  assert.match(css, /\.pxd-panel__page-chip[\s\S]*var\(--pxd-text\)/);
  assert.match(css, /\.pxd-panel__row--active[\s\S]*var\(--pxd-accent-soft\)/);
  assert.match(css, /\.bp3-dark \.pxd-root[\s\S]*\.pxd-panel__page-chip/);
});
