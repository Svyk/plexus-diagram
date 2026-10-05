// REG-2: the mark layer reports fracFromDrag. It does not write the graph.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createChrome } from "../src/view/chrome.js";
import { mountRegionMark } from "../src/view/region-mark.js";
import { TIP_TEXT } from "../src/view/tooltip-text.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const timers = { later: () => () => {}, frame: () => () => {} };

function rect(x, y, width, height) {
  return { x, y, left: x, top: y, width, height, right: x + width, bottom: y + height };
}

function mount() {
  const stub = createDomStub();
  const restore = stub.install();
  const root = stub.document.createElement("div");
  root.className = "pxd-root";
  root._rect = rect(10, 20, 800, 600);
  stub.document.body.append(root);
  const img = stub.document.createElement("img");
  img.className = "rm-inline-img";
  img._rect = rect(40, 80, 200, 100);
  root.append(img);
  return { stub, restore, root, img };
}

const at = (img, px, py) => [img._rect.x + img._rect.width * px, img._rect.y + img._rect.height * py];

test("REG-2: drag, type hamstring, confirm returns rx 0.25 ry 0.3 rw 0.2 rh 0.25", () => {
  const { stub, restore, root, img } = mount();
  const seen = [];
  try {
    const handle = mountRegionMark({
      doc: stub.document,
      root,
      img,
      onConfirm: (value) => { seen.push(value); },
      onCancel: () => { seen.push("cancel"); },
    });
    assert.equal(typeof handle.destroy, "function");
    const layer = root.querySelector(".pxd-region-layer");
    assert.equal(layer.parentElement, root);
    const [x0, y0] = at(img, 0.25, 0.3);
    const [x1, y1] = at(img, 0.45, 0.55);
    const down = stub.dispatch(layer, "pointerdown", { clientX: x0, clientY: y0, button: 0 });
    assert.equal(down.propagationStopped, true);
    assert.equal(down.defaultPrevented, true);
    const mouse = stub.dispatch(layer, "mousedown", { clientX: x0, clientY: y0, button: 0 });
    assert.equal(mouse.propagationStopped, true);
    assert.equal(mouse.defaultPrevented, true);
    stub.dispatch(stub.document, "pointermove", { clientX: x1, clientY: y1 });
    stub.dispatch(stub.document, "pointerup", { clientX: x1, clientY: y1 });
    const draft = root.querySelector(".pxd-region-draft");
    assert.equal(draft.style.left, "80px");
    assert.equal(draft.style.top, "90px");
    assert.equal(draft.style.width, "40px");
    assert.equal(draft.style.height, "25px");
    const input = root.querySelector(".pxd-region-caption");
    input.value = "hamstring";
    root.querySelector(".pxd-region-confirm").click();
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0].frac, { rx: 0.25, ry: 0.3, rw: 0.2, rh: 0.25 });
    assert.equal(seen[0].caption, "hamstring");
    assert.equal(root.querySelectorAll(".pxd-region-draft").length, 0);
    const moves = [...stub.listeners].filter((entry) => entry.type === "pointermove" && entry.target === stub.document);
    assert.equal(moves.length, 0);
    handle.destroy();
  } finally {
    restore();
  }
});

test("REG-2: a zero-size drag does not confirm", () => {
  const { stub, restore, root, img } = mount();
  let ran = false;
  try {
    mountRegionMark({
      doc: stub.document,
      root,
      img,
      onConfirm: () => { ran = true; },
    });
    const layer = root.querySelector(".pxd-region-layer");
    const [x, y] = at(img, 0.25, 0.3);
    stub.dispatch(layer, "pointerdown", { clientX: x, clientY: y, button: 0 });
    stub.dispatch(stub.document, "pointerup", { clientX: x, clientY: y });
    root.querySelector(".pxd-region-confirm").click();
    assert.equal(ran, false);
    assert.equal(root.querySelectorAll(".pxd-region-layer").length, 1);
  } finally {
    restore();
  }
});

test("REG-2: Esc removes every draft and does not confirm", () => {
  const { stub, restore, root, img } = mount();
  let confirmed = 0;
  let cancelled = 0;
  try {
    mountRegionMark({
      doc: stub.document,
      root,
      img,
      onConfirm: () => { confirmed += 1; },
      onCancel: () => { cancelled += 1; },
    });
    const layer = root.querySelector(".pxd-region-layer");
    const [x0, y0] = at(img, 0.25, 0.3);
    const [x1, y1] = at(img, 0.45, 0.55);
    stub.dispatch(layer, "pointerdown", { clientX: x0, clientY: y0, button: 0 });
    stub.dispatch(stub.document, "pointermove", { clientX: x1, clientY: y1 });
    stub.dispatch(stub.document, "pointerup", { clientX: x1, clientY: y1 });
    assert.ok(root.querySelector(".pxd-region-draft"));
    root.querySelector(".pxd-region-caption").value = "hamstring";
    stub.dispatch(stub.document, "keydown", { key: "Escape" });
    assert.equal(root.querySelectorAll(".pxd-region-draft").length, 0);
    assert.equal(stub.document.querySelectorAll(".pxd-region-draft").length, 0);
    assert.equal(confirmed, 0);
    assert.equal(cancelled, 1);
    const moves = [...stub.listeners].filter((entry) => entry.type === "pointermove" && entry.target === stub.document);
    assert.equal(moves.length, 0);
  } finally {
    restore();
  }
});

test("REG-2: Enter confirms the same fraction", () => {
  const { stub, restore, root, img } = mount();
  const seen = [];
  try {
    mountRegionMark({
      doc: stub.document,
      root,
      img,
      onConfirm: (value) => { seen.push(value); },
    });
    const layer = root.querySelector(".pxd-region-layer");
    const [x0, y0] = at(img, 0.25, 0.3);
    const [x1, y1] = at(img, 0.45, 0.55);
    stub.dispatch(layer, "pointerdown", { clientX: x0, clientY: y0, button: 0 });
    stub.dispatch(stub.document, "pointerup", { clientX: x1, clientY: y1 });
    const input = root.querySelector(".pxd-region-caption");
    input.value = "hamstring";
    stub.dispatch(input, "keydown", { key: "Enter" });
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0], { frac: { rx: 0.25, ry: 0.3, rw: 0.2, rh: 0.25 }, caption: "hamstring" });
  } finally {
    restore();
  }
});

test("REG-2: draft css is a 1.5px stroke, a dark halo, and no fill", () => {
  const css = readFileSync(new URL("../src/css/region-mark.css", import.meta.url), "utf8");
  const src = readFileSync(new URL("../src/view/region-mark.js", import.meta.url), "utf8");
  assert.match(css, /pxd-region-draft/);
  assert.match(css, /box-shadow/);
  assert.match(css, /\.pxd-region-draft\s*\{[^}]*border:\s*1\.5px[^}]*background:\s*transparent/);
  assert.match(css, /\.bp3-dark[^{]*\.pxd-region-draft\s*,[\s\S]*\{[^}]*border-color:\s*white[^}]*box-shadow:\s*0\s+0\s+0\s+1px\s+black/);
  const backgrounds = [...css.matchAll(/background(?:-color)?\s*:\s*([^;]+)/gi)].map((m) => m[1].trim().toLowerCase());
  assert.ok(backgrounds.length > 0);
  assert.ok(backgrounds.every((color) => color === "transparent"));
  assert.equal(/\bfill\s*:/.test(css), false);
  assert.equal(src.includes("setPointerCapture"), false);
  assert.match(src, /import \{ fracFromDrag \} from "\.\.\/model\/image-region\.js"/);
});

test("REG-2: Mark region is only on an image card", () => {
  const stub = createDomStub();
  const restore = stub.install();
  const root = stub.document.createElement("div");
  root.className = "pxd-root";
  stub.document.body.append(root);
  let marks = 0;
  try {
    const chrome = createChrome({
      doc: stub.document,
      root,
      version: "2.9.3",
      settings: {},
      timers,
      on: { markRegion: () => { marks += 1; } },
    });
    const show = (kind, model) => {
      chrome.ctx.show(kind, model, () => ({ kind, rect: { x: 40, y: 40, w: 120, h: 80 } }));
      return root.querySelector(".pxd-ctx__mark-region");
    };
    const image = show("card", { kind: "image" });
    assert.ok(image);
    assert.equal(image.getAttribute("aria-label"), "Mark region");
    assert.equal(image.getAttribute("data-tip"), "ctx.mark-region");
    assert.ok(image.querySelector(".bp3-icon-highlight"));
    image.click();
    assert.equal(marks, 1);
    for (const kind of ["note", "block", "page", "board"]) assert.equal(show("card", { kind }), null, kind);
    assert.equal(show("cards", { count: 2 }), null);
    assert.equal(show("section", {}), null);
    assert.equal(TIP_TEXT["ctx.mark-region"].name, "Mark region");
    assert.equal(TIP_TEXT["ctx.mark-region"].desc, "Drag a rectangle on this image.");
  } finally {
    restore();
  }
});

test("REG-2: confirm copies ((uid)) before addImageRegion and does not await", () => {
  const board = readFileSync(new URL("../src/view/board-view.js", import.meta.url), "utf8");
  const start = board.indexOf("markRegion:");
  assert.ok(start > 0);
  const body = board.slice(start, board.indexOf("duplicate:", start));
  const writeAt = body.indexOf("clipboard.writeText");
  const addAt = body.indexOf("addImageRegion");
  assert.ok(writeAt > 0 && addAt > writeAt);
  assert.match(body, /navigator\.clipboard\.writeText\(\s*`\(\(\$\{uid\}\)\)`\s*\)/);
  assert.match(body, /session\.addImageRegion\(\s*cardUid,\s*frac,\s*caption,\s*uid\s*\)/);
  assert.match(body, /host\.generateUid\(\)/);
  assert.match(body, /img\.rm-inline-img/);
  assert.match(body, /The image is not ready/);
  assert.match(body, /Region made, ref copied/);
  assert.equal(body.includes("await"), false);
});
