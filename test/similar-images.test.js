import assert from "node:assert/strict";
import test from "node:test";

import { colorPalette, paletteDistance, rgbToOklab, oklabToHex } from "../src/model/color.js";
import { similarImages } from "../src/model/image-search.js";
import { createPanel } from "../src/view/panel.js";
import { cpuNow } from "./fixtures/cpu-clock.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const entry = (r, g, b, weight) => { const lab = rgbToOklab(r, g, b); return { hex: oklabToHex(lab), lab, weight }; };
const RED = [entry(224, 32, 32, 0.7), entry(255, 255, 255, 0.3)];
const REDISH = [entry(210, 50, 40, 0.65), entry(250, 250, 250, 0.35)];
const BLUE = [entry(32, 96, 224, 0.7), entry(255, 255, 255, 0.3)];
const DARK = [entry(10, 10, 10, 1)];
const LIGHT = [entry(250, 250, 250, 1)];

test("paletteDistance: zero for the same palette, symmetric, near < far, share mismatch counts", () => {
  assert.equal(paletteDistance(RED, RED), 0);
  assert.ok(Math.abs(paletteDistance(RED, BLUE) - paletteDistance(BLUE, RED)) < 1e-9);
  assert.ok(paletteDistance(RED, REDISH) < paletteDistance(RED, BLUE));
  assert.ok(paletteDistance(DARK, LIGHT) > 0.8);
  const mostlyRed = [entry(224, 32, 32, 0.9), entry(255, 255, 255, 0.1)];
  const mostlyWhite = [entry(224, 32, 32, 0.1), entry(255, 255, 255, 0.9)];
  assert.ok(paletteDistance(mostlyRed, mostlyWhite) > paletteDistance(RED, mostlyRed));
});

test("paletteDistance: weights are normalised; sizes may differ; empty or weightless palettes are infinitely far", () => {
  const scaled = RED.map((e) => ({ ...e, weight: e.weight * 0.5 }));
  assert.ok(paletteDistance(RED, scaled) < 1e-9);
  assert.ok(Number.isFinite(paletteDistance(RED, DARK)));
  assert.equal(paletteDistance([], RED), Infinity);
  assert.equal(paletteDistance(RED, null), Infinity);
  assert.equal(paletteDistance(RED, [{ lab: [0, 0, 0], weight: 0 }]), Infinity);
});

test("paletteDistance works on real k-means palettes", () => {
  const solid = (r, g, b) => { const px = new Uint8ClampedArray(64 * 4); for (let i = 0; i < 64; i += 1) { px.set([r, g, b, 255], i * 4); } return colorPalette(px); };
  assert.ok(paletteDistance(solid(200, 30, 30), solid(210, 40, 35)) < paletteDistance(solid(200, 30, 30), solid(30, 30, 200)));
});

test("paletteDistance: 5,000 comparisons of 5-colour palettes under 20 ms", () => {
  const make = (seed) => Array.from({ length: 5 }, (_, i) => entry((seed * 37 + i * 51) % 256, (seed * 11 + i * 29) % 256, (seed * 53 + i * 17) % 256, (i + 1) / 15));
  const source = make(1);
  const others = Array.from({ length: 5000 }, (_, i) => make(i + 2));
  let best = Infinity;
  for (let run = 0; run < 5; run += 1) {
    const t0 = cpuNow();
    let sink = 0;
    for (const o of others) sink += paletteDistance(source, o);
    best = Math.min(best, cpuNow() - t0);
    assert.ok(sink > 0);
  }
  assert.ok(best < 20, `took ${best.toFixed(1)} ms`);
});

test("similarImages: nearest first, source and unindexed or failed items left out, figures and images mixed, capped", () => {
  const records = new Map([
    ["src", { palette: RED }],
    ["near", { palette: REDISH }],
    ["far", { palette: BLUE }],
    ["dark", { palette: DARK }],
    ["bad", { failed: true }],
    ["empty", { palette: [] }],
  ]);
  const items = [
    { key: "far", uid: "a" }, { key: "src", uid: "s" }, { key: "near", uid: "b", kind: "figure" }, { key: "dark", uid: "c" },
    { key: "missing", uid: "d" }, { key: "bad", uid: "e" }, { key: "empty", uid: "f" },
  ];
  const out = similarImages(items, records, "src", 40);
  assert.equal(out.ok, true);
  assert.deepEqual(out.rows.map((r) => r.key), ["near", "far", "dark"]);
  assert.equal(out.rows[0].kind, "figure");
  assert.deepEqual(out.rows[0].palette.length, 2);
  assert.ok(out.rows[0].distance < out.rows[1].distance);
  assert.equal(similarImages(items, records, "src", 2).rows.length, 2);
  assert.equal(similarImages(items, records, "nope").ok, false);
  assert.equal(similarImages(items, records, "bad").ok, false);
  assert.equal(similarImages(items, records, "empty").ok, false);
  assert.equal(similarImages(null, records, "src").rows.length, 0);
  const tie = similarImages([{ key: "x1" }, { key: "x2" }], new Map([["src", { palette: RED }], ["x1", { palette: BLUE }], ["x2", { palette: BLUE }]]), "src");
  assert.deepEqual(tie.rows.map((r) => r.key), ["x1", "x2"]);
});

// panel ---------------------------------------------------------------------------------------------------------------

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

const IMG = { key: "https://x.test/chart.png", url: "https://x.test/chart.png", uid: "u1", string: "![bar chart](https://x.test/chart.png)", pageTitle: "Notes", palette: ["#e02020", "#ffffff"] };
const IMG2 = { key: "https://x.test/b.png", url: "https://x.test/b.png", uid: "u2", string: "![](https://x.test/b.png)", pageTitle: "Plant notes", palette: ["#e02030"] };
const FIG = { key: "s/f2", kind: "figure", page: 3, text: "Figure 2 revenue", docTitle: "Report", blockId: "f2", sha256: "s", engine: "builtin", palette: ["#2060e0"] };

test("image and figure rows get a More like this button; clicking it enters similarity mode with a Like chip", async (t) => {
  const calls = [];
  const f = setup({
    on: {
      searchImages: async (query, limit) => {
        calls.push([query, limit]);
        if (query.like) return { similar: true, images: [IMG2], figures: [FIG], order: [{ ...IMG2, kind: "image" }, FIG] };
        return { images: [IMG], figures: [FIG] };
      },
      searchParts: async () => [],
    },
    host: { librarySearch: () => ({ rows: [], queries: [] }) },
  });
  t.after(f.restore);
  await search(f, "chart");
  const buttons = f.root.querySelectorAll(".pxd-panel__row-like");
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0].getAttribute("aria-label"), "More like this");
  assert.equal(buttons[0].getAttribute("data-like"), IMG.key);
  assert.equal(buttons[1].getAttribute("data-like"), "s/f2");
  assert.equal(q(f.root, ".pxd-panel__like").style.display, "none");
  f.stub.dispatch(buttons[0], "click");
  await tick(10);
  const chip = q(f.root, ".pxd-panel__like");
  assert.notEqual(chip.style.display, "none");
  assert.equal(q(f.root, ".pxd-panel__like-text").textContent, "Like: bar chart");
  const last = calls.at(-1);
  assert.deepEqual(last[0], { like: IMG.key, images: true, figures: true });
  assert.equal(last[1], 40);
  const rows = f.root.querySelectorAll(".pxd-panel__row");
  assert.equal(rows.length, 2);
  assert.equal(f.root.querySelectorAll(".pxd-panel__dot").length, 2);
  assert.equal(f.root.querySelectorAll(".pxd-panel__row-like").length, 2);
});

test("× clears similarity mode and goes back to the normal search; typing clears it too", async (t) => {
  const calls = [];
  const f = setup({
    on: {
      searchImages: async (query) => { calls.push(query); return query.like ? { similar: true, images: [IMG2], figures: [], order: [IMG2] } : { images: [IMG], figures: [] }; },
      searchParts: async () => [],
    },
    host: { librarySearch: () => ({ rows: [], queries: [] }) },
  });
  t.after(f.restore);
  await search(f, "chart");
  f.stub.dispatch(f.root.querySelectorAll(".pxd-panel__row-like")[0], "click");
  await tick(10);
  assert.equal(f.root.querySelectorAll(".pxd-panel__row").length, 1);
  f.stub.dispatch(q(f.root, ".pxd-panel__like-x"), "click");
  await tick(10);
  assert.equal(q(f.root, ".pxd-panel__like").style.display, "none");
  assert.equal(calls.at(-1).like, undefined);
  assert.equal(calls.at(-1).text, "chart");
  f.stub.dispatch(f.root.querySelectorAll(".pxd-panel__row-like")[0], "click");
  await tick(10);
  assert.notEqual(q(f.root, ".pxd-panel__like").style.display, "none");
  const input = q(f.root, ".pxd-panel__input");
  input.value = "red";
  f.stub.dispatch(input, "input");
  assert.equal(q(f.root, ".pxd-panel__like").style.display, "none");
});

test("similarity mode respects the Image and Figure toggles and reports an unindexed source or no matches", async (t) => {
  const seen = [];
  let reply = { similar: true, images: [], figures: [], order: [] };
  const f = setup({
    on: {
      searchImages: async (query) => { seen.push(query); return query.like ? reply : { images: [IMG], figures: [FIG] }; },
      searchParts: async () => [],
    },
    host: { librarySearch: () => ({ rows: [], queries: [] }) },
  });
  t.after(f.restore);
  await search(f, "chart");
  f.stub.dispatch(f.root.querySelectorAll(".pxd-panel__row-like")[0], "click");
  await tick(10);
  assert.match(q(f.root, ".pxd-panel__empty").textContent, /No similar images/);
  reply = { similar: false, images: [], figures: [] };
  f.stub.dispatch(q(f.root, ".pxd-panel__input"), "keydown", { key: "Enter" });
  await tick(10);
  assert.match(q(f.root, ".pxd-panel__empty").textContent, /no colours yet/);
  const box = f.root.querySelectorAll(".pxd-panel__type-box").find((b) => b.dataset.type === "figure");
  box.checked = false;
  f.stub.dispatch(box, "change");
  await tick(10);
  assert.deepEqual(seen.at(-1), { like: IMG.key, images: true, figures: false });
  const img = f.root.querySelectorAll(".pxd-panel__type-box").find((b) => b.dataset.type === "image");
  img.checked = false;
  f.stub.dispatch(img, "change");
  await tick(10);
  assert.match(q(f.root, ".pxd-panel__empty").textContent, /Turn on Image or Figure/);
});

test("no button without a search hook, and figure rows also offer Chart to table when the host can do it", async (t) => {
  const a = setup({ on: { searchParts: async () => [FIG] }, host: { librarySearch: () => ({ rows: [], queries: [] }) }, types: ["figure"] });
  t.after(a.restore);
  await search(a, "revenue");
  assert.equal(a.root.querySelectorAll(".pxd-panel__row-like").length, 0);
  assert.equal(a.root.querySelectorAll(".pxd-panel__row-chart").length, 0);
  const charted = [];
  const b = setup({
    on: { searchImages: async () => ({ images: [], figures: [FIG] }), searchParts: async () => [], chartPart: (part) => charted.push(part.blockId) },
    host: { librarySearch: () => ({ rows: [], queries: [] }) },
  });
  t.after(b.restore);
  await search(b, "revenue");
  const btn = q(b.root, ".pxd-panel__row-chart");
  assert.equal(btn.getAttribute("aria-label"), "Chart to table");
  b.stub.dispatch(btn, "click");
  assert.deepEqual(charted, ["f2"]);
});
