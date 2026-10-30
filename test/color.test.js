import assert from "node:assert/strict";
import test from "node:test";

import { COLOR_MIN_SCORE, colorPalette, colorQuery, colorScore, rgbToOklab } from "../src/model/color.js";
import { searchImages, splitImageQuery, stripColorWords } from "../src/model/image-search.js";
import { budgetMessage, measureBudget } from "./fixtures/speed.js";

function pixels(parts, total = 4096) {
  const out = new Uint8ClampedArray(total * 4);
  let at = 0;
  for (const [rgb, share] of parts) {
    const n = Math.round(total * share);
    for (let i = 0; i < n && at < total; i += 1, at += 1) {
      out.set([rgb[0], rgb[1], rgb[2], 255], at * 4);
    }
  }
  return out;
}

test("rgbToOklab: white, black, red", () => {
  const w = rgbToOklab(255, 255, 255);
  assert.ok(Math.abs(w[0] - 1) < 0.01 && Math.abs(w[1]) < 0.01);
  assert.ok(rgbToOklab(0, 0, 0)[0] < 0.01);
  const r = rgbToOklab(255, 0, 0);
  assert.ok(Math.abs(r[0] - 0.628) < 0.01 && Math.abs(r[1] - 0.2249) < 0.01);
});

test("palette: weights, order, determinism, transparency", () => {
  const data = pixels([[[220, 30, 30], 0.6], [[255, 255, 255], 0.3], [[20, 20, 200], 0.1]]);
  const a = colorPalette(data);
  const b = colorPalette(data);
  assert.deepEqual(a, b);
  assert.ok(a.length >= 3 && a.length <= 5);
  assert.ok(Math.abs(a.reduce((s, p) => s + p.weight, 0) - 1) < 0.02);
  assert.ok(a[0].weight >= a[1].weight);
  assert.match(a[0].hex, /^#[0-9a-f]{6}$/);
  const clear = new Uint8ClampedArray(64 * 4);
  assert.deepEqual(colorPalette(clear), []);
  const half = pixels([[[0, 200, 0], 1]], 100);
  for (let i = 0; i < 50; i += 1) half[i * 4 + 3] = 0;
  assert.equal(colorPalette(half).length, 1);
});

test("colorQuery parses names and hex only", () => {
  assert.equal(colorQuery("red").name, "red");
  assert.equal(colorQuery("Grey").name, "gray");
  assert.equal(colorQuery("#1e90ff").hex, "#1e90ff");
  assert.equal(colorQuery("#f00").hex, "#ff0000");
  assert.equal(colorQuery("chart"), null);
  assert.equal(colorQuery("#xyz"), null);
  assert.equal(colorQuery("black").achromatic, true);
  assert.equal(colorQuery("red").achromatic, false);
});

test("colorScore: red ranks red above blue and white; grayscale never matches chromatic names", () => {
  const red = colorPalette(pixels([[[224, 32, 32], 0.7], [[255, 255, 255], 0.3]]));
  const blue = colorPalette(pixels([[[32, 96, 224], 0.7], [[255, 255, 255], 0.3]]));
  const gray = colorPalette(pixels([[[120, 120, 120], 0.6], [[250, 250, 250], 0.4]]));
  const R = colorQuery("red");
  assert.ok(colorScore(red, R) > 0.5);
  assert.ok(colorScore(blue, R) < COLOR_MIN_SCORE);
  assert.equal(colorScore(gray, R), 0);
  for (const name of ["red", "orange", "green", "blue", "pink", "purple"]) assert.equal(colorScore(gray, colorQuery(name)), 0, name);
  assert.ok(colorScore(gray, colorQuery("gray")) > 0.3);
  assert.ok(colorScore(red, colorQuery("white")) > COLOR_MIN_SCORE);
  assert.equal(colorScore(red, colorQuery("black")), 0);
  assert.ok(colorScore(blue, colorQuery("#2060e0")) > 0.5);
  assert.ok(colorScore(blue, colorQuery("#1e90ff")) > COLOR_MIN_SCORE);
});

test("speed: k-means on 64x64 under 10 ms, colorScore over 5,000 palettes under 15 ms", () => {
  const data = new Uint8ClampedArray(4096 * 4);
  let seed = 7;
  for (let i = 0; i < data.length; i += 1) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; data[i] = i % 4 === 3 ? 255 : seed >> 8 & 255; }
  colorPalette(data);
  const kmeans = measureBudget(() => colorPalette(data), 10);
  assert.ok(kmeans.ok, budgetMessage("k-means", kmeans));
  const palette = colorPalette(pixels([[[224, 32, 32], 0.5], [[10, 10, 10], 0.3], [[255, 255, 255], 0.2]]));
  const palettes = Array.from({ length: 5000 }, () => palette);
  const target = colorQuery("red");
  let sum = 0;
  const score = measureBudget(() => { for (const p of palettes) sum += colorScore(p, target); }, 15);
  assert.ok(sum > 0);
  assert.ok(score.ok, budgetMessage("colorScore", score));
});

test("splitImageQuery and stripColorWords", () => {
  assert.deepEqual(splitImageQuery("blue chart").words, ["chart"]);
  assert.equal(splitImageQuery("blue chart").colors[0].name, "blue");
  assert.equal(stripColorWords("red \"blue sky\" #1e90ff logo"), "\"blue sky\" logo");
  assert.deepEqual(splitImageQuery("\"red\"").colors, []);
});

test("searchImages: colour, text, both, unindexed", () => {
  const pal = (rgb) => colorPalette(pixels([[rgb, 0.7], [[255, 255, 255], 0.3]]));
  const records = new Map([
    ["a", { palette: pal([224, 32, 32]), text: "Quarterly revenue" }],
    ["b", { palette: pal([32, 96, 224]), text: "Quarterly revenue" }],
    ["c", { palette: pal([224, 32, 32]), text: "" }],
    ["d", { failed: true, at: 1 }],
  ]);
  const items = [
    { key: "a", hay: "chart.png" }, { key: "b", hay: "chart2.png" }, { key: "c", hay: "logo.png" },
    { key: "d", hay: "broken.png" }, { key: "e", hay: "new.png" },
  ];
  const keys = (q) => searchImages(items, records, q).map((r) => r.key);
  assert.deepEqual(keys({ text: "red" }), ["a", "c"]);
  assert.deepEqual(keys({ text: "blue" }), ["b"]);
  assert.deepEqual(keys({ text: "revenue" }), ["a", "b"]);
  assert.deepEqual(keys({ text: "red revenue" }), ["a"]);
  assert.deepEqual(keys({ text: "red logo" }), ["c"]);
  assert.deepEqual(keys({ text: "" }), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(keys({ text: "new" }), ["e"]);
  const top = searchImages(items, records, { text: "red" })[0];
  assert.ok(top.palette.length >= 2 && top.palette.length <= 3);
  assert.ok(top.colorScore > 0.3);
  const figs = [{ key: "f1", hay: "figure 1", page: 2 }, { key: "f2", hay: "figure 2", page: 9 }];
  assert.deepEqual(searchImages(figs, new Map(), { text: "figure", pages: "1-4" }).map((r) => r.key), ["f1"]);
  const ocrHit = searchImages(items, records, { text: "revenue" }).find((r) => r.key === "a");
  assert.match(ocrHit.snippet, /Quarterly revenue/);
  assert.equal(searchImages(items, records, { text: "red" })[0].snippet, undefined);
});

test("hue ranges: mid blues match blue, teal is not blue, grays match no chromatic name", () => {
  const solo = (hex) => [{ hex, lab: rgbToOklab(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)), weight: 0.6 }];
  for (const hex of ["#3070c0", "#2b56a9", "#1e5fb4"]) {
    assert.ok(colorScore(solo(hex), colorQuery("blue")) >= COLOR_MIN_SCORE, hex);
  }
  const teal = solo("#2b9a8f");
  assert.ok(colorScore(teal, colorQuery("teal")) >= COLOR_MIN_SCORE);
  assert.ok(colorScore(teal, colorQuery("blue")) < COLOR_MIN_SCORE);
  for (const hex of ["#808080", "#a0a0a0", "#303030"]) {
    for (const name of ["red", "orange", "yellow", "green", "teal", "blue", "purple", "pink", "brown"]) assert.equal(colorScore(solo(hex), colorQuery(name)), 0, `${hex} ${name}`);
  }
  assert.ok(colorScore(solo("#8b5a2b"), colorQuery("brown")) >= COLOR_MIN_SCORE);
  assert.equal(colorScore(solo("#f08020"), colorQuery("brown")), 0);
  const sky = colorPalette(pixels([[[0x2a, 0x8b, 0xe8], 0.7], [[255, 255, 255], 0.3]]));
  assert.ok(colorScore(sky, colorQuery("#1e90ff")) >= COLOR_MIN_SCORE);
});
