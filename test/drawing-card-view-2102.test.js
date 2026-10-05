// ECO-4: the drawing card paints a detail thumb, two open buttons, and region rows.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { copyDrawingPixels, renderDrawingCard } from "../src/view/drawing-card.js";
import { createDomStub } from "./fixtures/dom-stub.js";

function paint(hooks, model = { title: "Sketch" }) {
  const stub = createDomStub();
  const restore = stub.install();
  const card = stub.document.createElement("div");
  card.className = "pxd-item";
  stub.document.body.append(card);
  const el = renderDrawingCard(stub.document, card, model, hooks);
  return { stub, restore, el };
}

test("ECO-4: the card has the drawing class, a title, and no thumb off detail", () => {
  const { restore, el } = paint({ tier: "map", visible: true, blob: "blob:nope" });
  try {
    assert.equal(el.classList.contains("pxd-item"), true);
    assert.equal(el.classList.contains("pxd-item--drawing"), true);
    assert.equal(el.querySelector(".pxd-drawing-title").textContent, "Sketch");
    assert.equal(el.querySelector("img"), null);
    assert.equal(el.querySelector(".pxd-drawing-regions"), null);
  } finally {
    restore();
  }
});

test("ECO-4: a missing card node still renders, and a caption is the title", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const el = renderDrawingCard(stub.document, null, { caption: "Macro" }, { tier: "map" });
    assert.equal(el.classList.contains("pxd-item--drawing"), true);
    assert.equal(el.querySelector(".pxd-drawing-title").textContent, "Macro");
    assert.equal(el.querySelector("img"), null);
    renderDrawingCard(stub.document, el, { title: "Next" }, { tier: "map" });
    assert.equal(el.querySelectorAll(".pxd-drawing-title").length, 1);
    assert.equal(el.querySelector(".pxd-drawing-title").textContent, "Next");
  } finally {
    restore();
  }
});

test("ECO-4: detail paints img.pxd-drawing-thumb from hooks.blob only while visible", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const card = stub.document.createElement("div");
    renderDrawingCard(stub.document, card, { title: "Hidden" }, {
      tier: "detail",
      visible: false,
      blob: "blob:hidden",
    });
    assert.equal(card.querySelector("img"), null);
    renderDrawingCard(stub.document, card, { title: "Shown" }, {
      tier: "detail",
      blob: "blob:shown",
    });
    const img = card.querySelector("img.pxd-drawing-thumb");
    assert.ok(img);
    assert.equal(card.querySelectorAll("img.pxd-drawing-thumb").length, 1);
    assert.equal(img.src, "blob:shown");
    assert.equal(img.alt, "");
  } finally {
    restore();
  }
});

test("ECO-4: a blob URL is revoked when the picture is replaced and on unmount", () => {
  const revoked = [];
  const prevRevoke = URL.revokeObjectURL;
  URL.revokeObjectURL = (url) => {
    revoked.push(String(url));
    try { prevRevoke.call(URL, url); } catch { /* already revoked */ }
  };
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const card = stub.document.createElement("div");
    const el = renderDrawingCard(stub.document, card, { title: "Sketch" }, {
      tier: "detail",
      visible: true,
      blob: new Blob(["a"], { type: "image/png" }),
    });
    const first = el.querySelector("img.pxd-drawing-thumb").src;
    assert.match(first, /^blob:/);
    renderDrawingCard(stub.document, el, { title: "Sketch" }, {
      tier: "detail",
      visible: true,
      blob: new Blob(["b"], { type: "image/png" }),
    });
    const second = el.querySelector("img.pxd-drawing-thumb").src;
    assert.match(second, /^blob:/);
    assert.notEqual(second, first);
    assert.deepEqual(revoked, [first]);
    el.pxdUnmount();
    assert.deepEqual(revoked, [first, second]);
    assert.equal(el.querySelector("img"), null);
  } finally {
    restore();
    URL.revokeObjectURL = prevRevoke;
  }
});

test("ECO-4: an image click stops propagation and does not call hooks.open", () => {
  const opened = [];
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const card = stub.document.createElement("div");
    stub.document.body.append(card);
    let bubbled = 0;
    card.addEventListener("click", () => { bubbled += 1; });
    const el = renderDrawingCard(stub.document, card, { title: "Sketch" }, {
      tier: "detail",
      visible: true,
      blob: "blob:pic",
      open(arg) { opened.push(arg); },
    });
    const img = el.querySelector("img.pxd-drawing-thumb");
    img.click();
    const again = stub.dispatch(img, "click");
    assert.equal(again.propagationStopped, true);
    assert.equal(bubbled, 0);
    assert.deepEqual(opened, []);
  } finally {
    restore();
  }
});

test("ECO-4: open buttons call hooks.open and stopPropagation", () => {
  const opened = [];
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const card = stub.document.createElement("div");
    stub.document.body.append(card);
    let bubbled = 0;
    card.addEventListener("click", () => { bubbled += 1; });
    const el = renderDrawingCard(stub.document, card, { title: "Sketch", uid: "card-uid" }, {
      tier: "map",
      open(arg) { opened.push(arg); },
    });
    const drawing = el.querySelector(".pxd-drawing-open");
    const sidebar = el.querySelector(".pxd-drawing-sidebar");
    assert.equal(el.querySelectorAll(".pxd-drawing-open").length, 1);
    assert.equal(el.querySelectorAll(".pxd-drawing-sidebar").length, 1);
    assert.equal(drawing.type, "button");
    assert.equal(drawing.getAttribute("type"), "button");
    assert.equal(sidebar.type, "button");
    assert.equal(sidebar.getAttribute("type"), "button");
    assert.equal(drawing.textContent, "Open drawing");
    assert.equal(sidebar.textContent, "Open in sidebar");
    drawing.click();
    sidebar.click();
    assert.deepEqual(opened, [{ sidebar: false }, { sidebar: true }]);
    assert.equal(Object.keys(opened[0]).join(","), "sidebar");
    assert.equal(bubbled, 0);
    const again = stub.dispatch(drawing, "click");
    assert.equal(again.propagationStopped, true);
    assert.deepEqual(opened[2], { sidebar: false });
    renderDrawingCard(stub.document, el, { title: "Sketch" }, { tier: "map", open(arg) { opened.push(arg); } });
    assert.equal(el.querySelectorAll(".pxd-drawing-open").length, 1);
    assert.equal(el.querySelectorAll(".pxd-drawing-sidebar").length, 1);
  } finally {
    restore();
  }
});

test("ECO-4: a regions array lists every caption and one click adds that uid", () => {
  const added = [];
  const opened = [];
  const regions = [
    { uid: "g", caption: "group", kind: "group" },
    { uid: "c", caption: "cframe", kind: "cframe" },
    { uid: "p", caption: "poly", kind: "poly" },
  ];
  const { stub, restore, el } = paint({
    tier: "map",
    regions,
    addRegion(uid) { added.push(uid); },
    open(arg) { opened.push(arg); },
  });
  try {
    const button = el.querySelector(".pxd-drawing-regions");
    assert.equal(button.textContent, "Regions");
    assert.equal(button.type, "button");
    const rows = el.querySelectorAll(".pxd-drawing-region");
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((row) => row.textContent), ["group", "cframe", "poly"]);
    rows[0].click();
    assert.deepEqual(added, ["g"]);
    rows[2].click();
    assert.deepEqual(added, ["g", "p"]);
    assert.deepEqual(opened, []);
    button.click();
    assert.equal(el.querySelector(".pxd-drawing-region-list").classList.contains("is-open"), true);
    button.click();
    assert.equal(el.querySelector(".pxd-drawing-region-list").classList.contains("is-open"), false);
    assert.deepEqual(added, ["g", "p"]);
    const stopped = stub.dispatch(rows[1], "click");
    assert.equal(stopped.propagationStopped, true);
    assert.deepEqual(added, ["g", "p", "c"]);
    renderDrawingCard(stub.document, el, { title: "Sketch" }, { tier: "map" });
    assert.equal(el.querySelector(".pxd-drawing-regions"), null);
    assert.equal(el.querySelector(".pxd-drawing-region"), null);
  } finally {
    restore();
  }
});

test("ECO-4: regions that are not an array paint no Regions button", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const card = stub.document.createElement("div");
    renderDrawingCard(stub.document, card, { title: "Sketch" }, { tier: "detail", regions: null, blob: "blob:x" });
    assert.equal(card.querySelector(".pxd-drawing-regions"), null);
    renderDrawingCard(stub.document, card, { title: "Sketch" }, { tier: "map", regions: { uid: "a", caption: "no" } });
    assert.equal(card.querySelector(".pxd-drawing-regions"), null);
    assert.equal(card.querySelector("img"), null);
  } finally {
    restore();
  }
});

test("ECO-4: copyDrawingPixels draws the image and does not read src after the draw", () => {
  const stub = createDomStub();
  const restore = stub.install();
  const log = [];
  const draws = [];
  const orig = stub.document.createElement.bind(stub.document);
  let made = null;
  stub.document.createElement = (tag) => {
    const el = orig(tag);
    if (String(tag).toLowerCase() === "canvas") {
      made = el;
      el.getContext = () => ({
        drawImage(image, ...rest) {
          log.push("draw");
          draws.push({ image, rest });
        },
      });
    }
    return el;
  };
  const img = {
    naturalWidth: 2400,
    naturalHeight: 1507,
    width: 12,
    height: 8,
    get src() {
      log.push("src");
      return "blob:hidden";
    },
  };
  try {
    const canvas = copyDrawingPixels(img, stub.document);
    assert.equal(canvas, made);
    assert.equal(canvas.tagName, "CANVAS");
    assert.equal(canvas.width, 2400);
    assert.equal(canvas.height, 1507);
    assert.equal(draws.length, 1);
    assert.equal(draws[0].image, img);
    assert.deepEqual(draws[0].rest, [0, 0, 2400, 1507]);
    const drawAt = log.indexOf("draw");
    assert.ok(drawAt >= 0);
    assert.equal(log.slice(drawAt + 1).includes("src"), false);
  } finally {
    restore();
  }
});

test("ECO-4: css fits the thumb and signals each button with a 1px border", () => {
  const css = readFileSync(new URL("../src/css/drawing-card.css", import.meta.url), "utf8");
  const src = readFileSync(new URL("../src/view/drawing-card.js", import.meta.url), "utf8");
  assert.match(css, /\.pxd-drawing-thumb\b[\s\S]*?max-width:\s*100%/);
  assert.match(css, /\.pxd-drawing-open\b[\s\S]*?border:\s*1px\b[\s\S]*?background:\s*var\(--pxd-card\)/);
  assert.match(css, /\.pxd-drawing-sidebar\b[\s\S]*?border:\s*1px\b[\s\S]*?background:\s*var\(--pxd-card\)/);
  assert.equal(src.includes("setPointerCapture"), false);
  assert.equal(src.includes("roamAlphaAPI"), false);
  assert.equal(src.includes("createBlock"), false);
});
