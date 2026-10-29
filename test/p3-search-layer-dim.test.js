// PERF5-P3: with no edge among the hits, search dims the edge and label layers by one attribute each instead of a class
// on every edge and label (QA: 4,200 class changes on the first key of a 2,100-edge board).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mountBig } from "./fixtures/big-mount.js";

const search = (m, text) => {
  const input = m.view.root.querySelector(".pxd-search__input");
  input.value = text;
  m.stub.dispatch(input, "input", {});
  return input;
};

test("P3: search with no edge hit sets one dim attribute on the edge and label layers, and no per-edge dim class", async () => {
  const m = mountBig({ x: 0, y: 0, zoom: 0.5 }, { virtualClock: true });
  try {
    await m.pump(4);
    m.view.root.focus();
    m.stub.dispatch(m.stub.window, "keydown", { key: "f", metaKey: true });
    const svg = m.view.root.querySelector(".pxd-edges");
    const labels = m.view.root.querySelector(".pxd-labels");
    assert.ok(m.view.root.querySelectorAll(".pxd-edge").length > 100, "edges mounted");
    const input = search(m, "card 1");
    assert.equal(svg.hasAttribute("data-pxd-search-dim"), true);
    assert.equal(labels.hasAttribute("data-pxd-search-dim"), true);
    assert.equal(m.view.root.querySelectorAll(".pxd-edge--dim").length, 0, "no per-edge dim class");
    assert.equal(m.view.root.querySelectorAll(".pxd-label--dim").length, 0, "no per-label dim class");
    m.stub.dispatch(input, "keydown", { key: "Escape" });
    assert.equal(svg.hasAttribute("data-pxd-search-dim"), false, "close clears the layer dim");
    assert.equal(labels.hasAttribute("data-pxd-search-dim"), false);
  } finally {
    m.done();
  }
});

test("P3: searchLayerDim off keeps the per-edge dim classes", async () => {
  const m = mountBig({ x: 0, y: 0, zoom: 0.5 }, { flags: { searchLayerDim: false }, virtualClock: true });
  try {
    await m.pump(4);
    m.view.root.focus();
    m.stub.dispatch(m.stub.window, "keydown", { key: "f", metaKey: true });
    search(m, "card 1");
    assert.equal(m.view.root.querySelector(".pxd-edges").hasAttribute("data-pxd-search-dim"), false);
    assert.ok(m.view.root.querySelectorAll(".pxd-edge--dim").length > 100);
  } finally {
    m.done();
  }
});
