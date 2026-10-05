// ECO-3: the crop card paints a caption, a detail thumbnail, and two open buttons.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { renderRegionCard, thumbRequest } from "../src/view/region-card.js";
import { createDomStub } from "./fixtures/dom-stub.js";

function paint(hooks, model = { caption: "Hamstring" }) {
  const stub = createDomStub();
  const restore = stub.install();
  const card = stub.document.createElement("div");
  card.className = "pxd-item";
  stub.document.body.append(card);
  const el = renderRegionCard(stub.document, card, model, hooks);
  return { stub, restore, el };
}

test("ECO-3: thumbRequest is false for the same or a non-positive width", () => {
  assert.equal(thumbRequest(160, 160), false);
  assert.equal(thumbRequest(160, "160"), false);
  assert.equal(thumbRequest(160, 0), false);
  assert.equal(thumbRequest(160, -4), false);
  assert.equal(thumbRequest(0, 0), false);
  assert.equal(thumbRequest(100, Number.NaN), false);
  assert.equal(thumbRequest(100, Number.POSITIVE_INFINITY), false);
  assert.equal(thumbRequest(160, 200), true);
  assert.equal(thumbRequest(0, 160), true);
  assert.equal(thumbRequest(undefined, 80), true);
});

test("ECO-3: the card always shows the caption and the region class", () => {
  const { restore, el } = paint({ tier: "map", visible: false, thumbnail() { throw new Error("no thumb"); } });
  try {
    assert.equal(el.classList.contains("pxd-item"), true);
    assert.equal(el.classList.contains("pxd-item--region"), true);
    assert.equal(el.querySelector(".pxd-region-caption").textContent, "Hamstring");
    assert.equal(el.querySelector("img"), null);
  } finally {
    restore();
  }
});

test("ECO-3: a caption update keeps one caption node", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const card = stub.document.createElement("div");
    const el = renderRegionCard(stub.document, card, { caption: "First" }, { tier: "map", visible: false });
    renderRegionCard(stub.document, el, { caption: "" }, { tier: "map", visible: false });
    assert.equal(el.querySelectorAll(".pxd-region-caption").length, 1);
    assert.equal(el.querySelector(".pxd-region-caption").textContent, "");
    assert.equal(renderRegionCard(stub.document, null, null, {}).querySelector(".pxd-region-caption").textContent, "");
  } finally {
    restore();
  }
});

test("ECO-3: detail calls thumbnail with maxWidth and no render", () => {
  const seen = [];
  let rendered = 0;
  const { restore, el } = paint({
    tier: "detail",
    visible: true,
    maxWidth: 160,
    render() { rendered += 1; },
    thumbnail(...args) {
      seen.push(args);
      return null;
    },
  });
  try {
    assert.equal(seen.length, 1);
    assert.equal(seen[0].length, 1);
    assert.deepEqual(seen[0][0], { maxWidth: 160 });
    assert.equal(Object.hasOwn(seen[0][0], "render"), false);
    assert.equal(rendered, 0);
    assert.equal(el.querySelector("img"), null);
    assert.equal(el.querySelector(".pxd-region-caption").textContent, "Hamstring");
  } finally {
    restore();
  }
});

test("ECO-3: map tier and visible false call thumbnail zero times", () => {
  let calls = 0;
  const thumbnail = () => { calls += 1; return null; };
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const card = stub.document.createElement("div");
    renderRegionCard(stub.document, card, { caption: "Map" }, { tier: "map", visible: true, maxWidth: 160, thumbnail });
    assert.equal(calls, 0);
    assert.equal(card.querySelector(".pxd-region-caption").textContent, "Map");
    renderRegionCard(stub.document, card, { caption: "Hidden" }, { tier: "detail", visible: false, maxWidth: 160, thumbnail });
    assert.equal(calls, 0);
    assert.equal(card.querySelector(".pxd-region-caption").textContent, "Hidden");
    assert.equal(card.querySelector("img"), null);
    renderRegionCard(stub.document, card, { caption: "Still" }, { tier: "detail", thumbnail });
    assert.equal(calls, 1);
  } finally {
    restore();
  }
});

test("ECO-3: a blob becomes img.pxd-region-thumb and a later null removes it", () => {
  const blob = new Blob(["png"], { type: "image/png" });
  const { stub, restore, el } = paint({
    tier: "detail",
    visible: true,
    maxWidth: 80,
    thumbnail(opts) {
      assert.deepEqual(opts, { maxWidth: 80 });
      return blob;
    },
  });
  try {
    const img = el.querySelector("img.pxd-region-thumb");
    assert.ok(img);
    assert.equal(el.querySelectorAll("img.pxd-region-thumb").length, 1);
    renderRegionCard(stub.document, el, { caption: "Hamstring" }, {
      tier: "detail",
      visible: true,
      maxWidth: 80,
      thumbnail() { return null; },
    });
    assert.equal(el.querySelector("img"), null);
    assert.equal(el.querySelector(".pxd-region-caption").textContent, "Hamstring");
  } finally {
    restore();
  }
});

test("ECO-3: object URLs are revoked on replace and unmount", async () => {
  const made = [];
  const revoked = [];
  const prevCreate = URL.createObjectURL;
  const prevRevoke = URL.revokeObjectURL;
  URL.createObjectURL = (file) => {
    const url = `blob:region-${made.length}`;
    made.push(file);
    return url;
  };
  URL.revokeObjectURL = (url) => { revoked.push(url); };
  const stub = createDomStub();
  const restore = stub.install();
  let resolveFirst;
  const first = new Promise((resolve) => { resolveFirst = resolve; });
  let step = 0;
  try {
    const card = stub.document.createElement("div");
    const hooks = {
      tier: "detail",
      visible: true,
      maxWidth: 160,
      thumbnail() {
        step += 1;
        if (step === 1) return first;
        return new Blob(["b"]);
      },
    };
    const el = renderRegionCard(stub.document, card, { caption: "Crop" }, hooks);
    assert.equal(el.querySelector("img"), null);
    resolveFirst(new Blob(["a"]));
    await first;
    await Promise.resolve();
    const img = el.querySelector("img.pxd-region-thumb");
    assert.equal(img.src, "blob:region-0");
    renderRegionCard(stub.document, el, { caption: "Crop" }, hooks);
    assert.deepEqual(revoked, ["blob:region-0"]);
    assert.equal(el.querySelector("img.pxd-region-thumb").src, "blob:region-1");
    el.pxdUnmount();
    assert.deepEqual(revoked, ["blob:region-0", "blob:region-1"]);
    assert.equal(el.querySelector("img"), null);
    resolveFirst = null;
  } finally {
    restore();
    if (prevCreate) URL.createObjectURL = prevCreate; else delete URL.createObjectURL;
    if (prevRevoke) URL.revokeObjectURL = prevRevoke; else delete URL.revokeObjectURL;
  }
});

test("ECO-3: a stale thumbnail does not replace a newer one", async () => {
  const urls = [];
  const prevCreate = URL.createObjectURL;
  const prevRevoke = URL.revokeObjectURL;
  URL.createObjectURL = () => `blob:race-${urls.push(urls.length)}`;
  URL.revokeObjectURL = () => {};
  const stub = createDomStub();
  const restore = stub.install();
  let resolveOld;
  try {
    const card = stub.document.createElement("div");
    renderRegionCard(stub.document, card, { caption: "Crop" }, {
      tier: "detail",
      visible: true,
      maxWidth: 160,
      thumbnail() { return new Promise((resolve) => { resolveOld = resolve; }); },
    });
    renderRegionCard(stub.document, card, { caption: "Crop" }, {
      tier: "detail",
      visible: true,
      maxWidth: 200,
      thumbnail() { return new Blob(["new"]); },
    });
    assert.equal(card.querySelector("img.pxd-region-thumb").src, "blob:race-1");
    resolveOld(new Blob(["old"]));
    await Promise.resolve();
    assert.equal(card.querySelector("img.pxd-region-thumb").src, "blob:race-1");
    assert.equal(urls.length, 1);
  } finally {
    restore();
    if (prevCreate) URL.createObjectURL = prevCreate; else delete URL.createObjectURL;
    if (prevRevoke) URL.revokeObjectURL = prevRevoke; else delete URL.revokeObjectURL;
  }
});

test("ECO-3: open buttons call hooks.open and stopPropagation", () => {
  const opened = [];
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const card = stub.document.createElement("div");
    stub.document.body.append(card);
    let bubbled = 0;
    card.addEventListener("click", () => { bubbled += 1; });
    const el = renderRegionCard(stub.document, card, { caption: "Hamstring" }, {
      tier: "map",
      open(arg) { opened.push(arg); },
    });
    const drawing = el.querySelector(".pxd-region-open");
    const sidebar = el.querySelector(".pxd-region-sidebar");
    assert.equal(el.querySelectorAll(".pxd-region-open").length, 1);
    assert.equal(el.querySelectorAll(".pxd-region-sidebar").length, 1);
    assert.equal(drawing.type, "button");
    assert.equal(drawing.getAttribute("type"), "button");
    assert.equal(sidebar.type, "button");
    assert.equal(sidebar.getAttribute("type"), "button");
    assert.equal(drawing.textContent, "Open drawing");
    assert.equal(sidebar.textContent, "Open in sidebar");
    drawing.click();
    sidebar.click();
    assert.deepEqual(opened, [{ sidebar: false }, { sidebar: true }]);
    assert.equal(bubbled, 0);
    const again = stub.dispatch(drawing, "click");
    assert.equal(again.propagationStopped, true);
    assert.deepEqual(opened[2], { sidebar: false });
  } finally {
    restore();
  }
});

test("ECO-3: css fits the thumb and signals each button with a 1px border", () => {
  const css = readFileSync(new URL("../src/css/region-card.css", import.meta.url), "utf8");
  const src = readFileSync(new URL("../src/view/region-card.js", import.meta.url), "utf8");
  assert.match(css, /\.pxd-region-thumb\b[\s\S]*?max-width:\s*100%/);
  assert.match(css, /\.pxd-region-open\b[\s\S]*?border:\s*1px\b[\s\S]*?background:\s*var\(--pxd-card\)/);
  assert.match(css, /\.pxd-region-sidebar\b[\s\S]*?border:\s*1px\b[\s\S]*?background:\s*var\(--pxd-card\)/);
  assert.equal(src.includes("setPointerCapture"), false);
  assert.equal(src.includes("new Map"), false);
});
