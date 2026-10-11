import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createPanel } from "../src/view/panel.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const timers = { later: () => () => {}, frame: () => () => {} };

function setup({ types = ["image", "figure"], on = {}, host = {} } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const root = stub.document.createElement("div");
  root.className = "pxd-root";
  stub.document.body.append(root);
  const panel = createPanel({ doc: stub.document, root, host, timers, on: { loadTypes: () => types, ...on } });
  return { stub, restore, root, panel };
}
const q = (root, sel) => root.querySelector(sel);
const search = async (f, text) => {
  const input = q(f.root, ".pxd-panel__input");
  input.value = text;
  f.stub.dispatch(input, "keydown", { key: "Enter" });
  await tick(5);
};

const IMG = { uid: "u1", string: "![chart](https://x.test/chart.png)", pageTitle: "Notes", palette: ["#e02020", "#ffffff"] };
const FIG = { kind: "figure", page: 3, text: "Figure 2 revenue", docTitle: "Report", blockId: "f2", sha256: "s", engine: "builtin", palette: ["#2060e0"] };

test("swatches show only when Image or Figure is on and a search hook exists", (t) => {
  const on = { searchImages: async () => ({ images: [], figures: [] }) };
  const a = setup({ on, types: ["image"] });
  t.after(a.restore);
  const swatches = q(a.root, ".pxd-panel__swatches");
  assert.notEqual(swatches.style.display, "none");
  assert.equal(a.root.querySelectorAll(".pxd-panel__swatch").length, 12);
  const b = setup({ on, types: ["page"] });
  t.after(b.restore);
  assert.equal(q(b.root, ".pxd-panel__swatches").style.display, "none");
  const c = setup({ types: ["image"] });
  t.after(c.restore);
  assert.equal(q(c.root, ".pxd-panel__swatches").style.display, "none");
});

test("image and figure types go to searchImages, with palette dots, and leave images out of the host query", async (t) => {
  const calls = [];
  const hostCalls = [];
  const f = setup({
    on: {
      searchImages: async (query, limit) => { calls.push([query, limit]); return { images: [IMG], figures: [FIG] }; },
      searchParts: async () => [],
    },
    host: { librarySearch: (filter) => { hostCalls.push(filter); return { rows: [], queries: [] }; } },
  });
  t.after(f.restore);
  await search(f, "blue chart");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][0], { text: "blue chart", images: true, figures: true, pages: "" });
  assert.ok(hostCalls.every((h) => !h.types.includes("image")));
  const rows = f.root.querySelectorAll(".pxd-panel__row");
  assert.equal(rows.length, 2);
  assert.equal(q(f.root, ".pxd-panel__thumb").getAttribute("src"), "https://x.test/chart.png");
  assert.equal(f.root.querySelectorAll(".pxd-panel__dot").length, 3);
});

test("with other types on, the host query excludes image and keeps the text as typed", async (t) => {
  const hostCalls = [];
  const f = setup({
    types: ["page", "image"],
    on: { searchImages: async () => ({ images: [IMG], figures: [] }) },
    host: { librarySearch: (filter) => { hostCalls.push(filter); return { rows: [{ string: "[[red]]", text: "red", kind: "page", label: "page" }], queries: [] }; } },
  });
  t.after(f.restore);
  await search(f, "red");
  assert.equal(hostCalls.length, 1);
  assert.deepEqual(hostCalls[0].types, ["page"]);
  assert.equal(hostCalls[0].text, "red");
  assert.equal(f.root.querySelectorAll(".pxd-panel__row").length, 2);
});

test("clicking a swatch toggles the colour word in the query and searches", async (t) => {
  const texts = [];
  const f = setup({ on: { searchImages: async (query) => { texts.push(query.text); return { images: [], figures: [] }; } } });
  t.after(f.restore);
  const input = q(f.root, ".pxd-panel__input");
  input.value = "chart";
  const red = f.root.querySelectorAll(".pxd-panel__swatch").find((b) => b.dataset.color === "red");
  f.stub.dispatch(red, "click");
  await tick(5);
  assert.equal(input.value, "chart red");
  assert.equal(red.getAttribute("aria-pressed"), "true");
  f.stub.dispatch(red, "click");
  await tick(5);
  assert.equal(input.value, "chart");
  assert.deepEqual(texts, ["chart red", "chart"]);
});

test("typing reports to the host and does not run the search synchronously", (t) => {
  let typed = 0;
  let searched = 0;
  const f = setup({ on: { typing: () => { typed += 1; }, searchImages: async () => { searched += 1; return { images: [], figures: [] }; } } });
  t.after(f.restore);
  const input = q(f.root, ".pxd-panel__input");
  input.value = "x";
  f.stub.dispatch(input, "input");
  assert.equal(typed, 1);
  assert.equal(searched, 0);
});

test("the footer shows the indexing count and hides at zero", (t) => {
  const f = setup({ on: { searchImages: async () => ({ images: [], figures: [] }) } });
  t.after(f.restore);
  const note = q(f.root, ".pxd-panel__index-note");
  assert.equal(note.style.display, "none");
  f.panel.setIndexing(12);
  assert.equal(note.textContent, "Indexing 12 images…");
  assert.notEqual(note.style.display, "none");
  f.panel.setIndexing(0);
  assert.equal(note.style.display, "none");
});

test("image row layout: thumbnail, then a text column with name over 'in page', then dots", async (t) => {
  const f = setup({ on: { searchImages: async () => ({ images: [{ ...IMG, pageTitle: "A very long page title ".repeat(8) }], figures: [] }), searchParts: async () => [] } });
  t.after(f.restore);
  await search(f, "blue");
  const row = q(f.root, ".pxd-panel__row--image");
  assert.ok(row);
  const kids = [...row.children].map((c) => c.className.split(" ")[0]);
  assert.deepEqual(kids, ["pxd-panel__thumb", "pxd-panel__row-col", "pxd-panel__dots"]);
  const col = q(row, ".pxd-panel__row-col");
  assert.deepEqual([...col.children].map((c) => c.className.split(" ")[0]), ["pxd-panel__row-text", "pxd-panel__row-label"]);
  assert.match(col.children[1].textContent, /^in A very long/);
});

test("image row layout CSS: text column can shrink and ellipsises; thumb and dots do not shrink", () => {
  const css = readFileSync(new URL("../src/extension.css", import.meta.url), "utf8");
  const rule = (sel) => css.split("}").find((b) => b.includes(sel) && b.trim().startsWith(sel.split(",")[0].trim())) || "";
  const col = rule(".pxd-panel__row-col {");
  assert.match(col, /flex:\s*1 1 auto/);
  assert.match(col, /min-width:\s*0/);
  const sub = css.split("}").find((b) => b.includes(".pxd-panel__row-col .pxd-panel__row-sub")) || "";
  assert.match(sub, /text-overflow:\s*ellipsis/);
  assert.match(sub, /white-space:\s*nowrap/);
  assert.match(sub, /min-width:\s*0/);
  assert.match(rule(".pxd-panel__thumb {"), /flex:\s*0 0 auto/);
  assert.match(rule(".pxd-panel__dots {"), /flex:\s*0 0 auto/);
});
