// REG-4: crop math, claim, and the button that comes back on destroy.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  claimRegionButton,
  cropFrame,
  eachRegionButton,
  mountRegionCrop,
  regionButtonUid,
  resetCropUrls,
} from "../src/view/region-crop.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const frac = { rx: 0.25, ry: 0.3, rw: 0.2, rh: 0.25 };
const region = { kind: "img", drawingUid: "imgBlock1", caption: "hamstring", f: frac, owner: "plexus-diagram", supported: true };

function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} near ${expected}`);
}

test("REG-4: cropFrame scales a 1600 by 1000 image to max height 160", () => {
  const box = cropFrame(frac, 1600, 1000, 160);
  near(box.frameW, 204.8);
  near(box.frameH, 160);
  near(box.imgW, 1024);
  near(box.imgH, 640);
  near(box.left, -256);
  near(box.top, -192);
  assert.equal(cropFrame({ ...frac, rw: 0 }, 1600, 1000, 160), null);
  const fromParser = cropFrame([0.25, 0.3, 0.2, 0.25], 1600, 1000, 160);
  near(fromParser.frameH, 160);
  near(fromParser.left, -256);
  const small = cropFrame({ rx: 0, ry: 0, rw: 0.5, rh: 0.1 }, 200, 100, 160);
  near(small.frameH, 10);
  near(small.frameW, 100);
});

test("REG-4: the region uid prefers the block ref over the container", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const container = stub.document.createElement("div");
    container.className = "roam-block-container";
    container.setAttribute("data-block-uid", "PDx3L69_C");
    const ref = stub.document.createElement("span");
    ref.className = "rm-block-ref";
    ref.setAttribute("data-uid", "di15RRYuH");
    const button = stub.document.createElement("button");
    button.className = "rm-xparser-default-plexus-region";
    button.textContent = "plexus-region";
    ref.append(button);
    container.append(ref);
    stub.document.body.append(container);
    assert.equal(regionButtonUid(button), "di15RRYuH");
    button.remove();
    container.append(button);
    assert.equal(regionButtonUid(button), "PDx3L69_C");
  } finally {
    restore();
  }
});

test("REG-4: claim hides our button once and leaves a Roam Plexus button alone", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const button = stub.document.createElement("button");
    button.textContent = "plexus-region";
    assert.equal(claimRegionButton(button), true);
    assert.equal(button.getAttribute("data-plexus-owner"), "plexus-diagram");
    assert.equal(button.style.display, "none");
    assert.equal(button.textContent, "plexus-region");
    assert.equal(claimRegionButton(button), false);
    const theirs = stub.document.createElement("button");
    theirs.setAttribute("data-plexus-owner", "roam-plexus");
    theirs.textContent = "plexus-region";
    assert.equal(claimRegionButton(theirs), false);
    assert.equal(theirs.getAttribute("data-plexus-owner"), "roam-plexus");
    assert.notEqual(theirs.style.display, "none");
  } finally {
    restore();
  }
});

test("REG-4: a file crop uses the frame, and a missing file says image unavailable", () => {
  const stub = createDomStub();
  const restore = stub.install();
  const made = [];
  const revoked = [];
  const prevCreate = URL.createObjectURL;
  const prevRevoke = URL.revokeObjectURL;
  URL.createObjectURL = (file) => { const url = `blob:${made.length}`; made.push(file); return url; };
  URL.revokeObjectURL = (url) => { revoked.push(url); };
  try {
    resetCropUrls();
    const button = stub.document.createElement("button");
    button.textContent = "plexus-region";
    claimRegionButton(button);
    stub.document.body.append(button);
    const file = new Blob(["png"], { type: "image/png" });
    const handle = mountRegionCrop({ doc: stub.document, button, region, file, maxH: 160 });
    const again = mountRegionCrop({ doc: stub.document, button, region, file, maxH: 160 });
    assert.equal(made.length, 1);
    const img = handle.el.querySelector(".pxd-region-crop__img");
    img.naturalWidth = 1600;
    img.naturalHeight = 1000;
    stub.dispatch(img, "load", {});
    const frame = handle.el.querySelector(".pxd-region-crop__frame");
    assert.equal(handle.el.style.display, "inline-flex");
    assert.equal(handle.el.style["max-width"], "none");
    assert.equal(frame.style.display, "inline-block");
    assert.equal(frame.style.position, "relative");
    assert.equal(frame.style.overflow, "hidden");
    assert.equal(frame.style["max-width"], "none");
    near(parseFloat(frame.style.width), 204.8);
    near(parseFloat(frame.style.height), 160);
    near(parseFloat(img.style.left), -256);
    near(parseFloat(img.style.top), -192);
    assert.equal(handle.el.querySelector(".pxd-region-crop__caption").textContent, "hamstring");
    handle.destroy();
    again.destroy();
    assert.equal(button.style.display, "");
    assert.equal(button.getAttribute("data-plexus-owner"), null);
    assert.equal(button.textContent, "plexus-region");
    assert.equal(revoked.length, 1);
    assert.equal(stub.document.querySelector(".pxd-region-crop"), null);

    const empty = stub.document.createElement("button");
    empty.textContent = "plexus-region";
    stub.document.body.append(empty);
    const missing = mountRegionCrop({ doc: stub.document, button: empty, region, file: null, maxH: 160 });
    assert.equal(missing.el.querySelector(".pxd-region-crop__missing").textContent, "image unavailable");
    assert.equal(missing.el.querySelector(".pxd-region-crop__caption").textContent, "hamstring");
    missing.destroy();
  } finally {
    resetCropUrls();
    if (prevCreate) URL.createObjectURL = prevCreate; else delete URL.createObjectURL;
    if (prevRevoke) URL.revokeObjectURL = prevRevoke; else delete URL.revokeObjectURL;
    restore();
  }
});

test("REG-4: a scan examines at most 60 buttons", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const seen = [];
    for (let i = 0; i < 61; i += 1) {
      const button = stub.document.createElement("button");
      button.className = "rm-xparser-default-plexus-region";
      button.setAttribute("data-n", String(i));
      stub.document.body.append(button);
    }
    const n = eachRegionButton(stub.document, (button) => seen.push(button.getAttribute("data-n")), 60);
    assert.equal(n, 60);
    assert.equal(seen.length, 60);
    assert.equal(seen[0], "0");
    assert.equal(seen[59], "59");
  } finally {
    restore();
  }
});

test("REG-4: crop css is a 1px stroke in light and dark, with no shadow", () => {
  const css = readFileSync(new URL("../src/css/region-crop.css", import.meta.url), "utf8");
  assert.match(css, /\.pxd-region-crop\.pxd-region-crop\s*\{[^}]*display:\s*inline-flex !important;/s);
  assert.match(css, /\.pxd-region-crop \.pxd-region-crop__frame\s*\{[^}]*display:\s*inline-block !important;/s);
  assert.match(css, /\.pxd-region-crop \.pxd-region-crop__frame\s*\{[^}]*border:\s*1px solid #1f2937;/s);
  assert.match(css, /\.bp3-dark \.pxd-region-crop \.pxd-region-crop__frame\s*,\s*\.pxd-root--dark \.pxd-region-crop \.pxd-region-crop__frame\s*\{[^}]*border-color:\s*#fff;/s);
  assert.match(css, /\.bp3-dark \.pxd-region-crop \.pxd-region-crop__frame[\s\S]*box-shadow:\s*none;/);
  assert.equal(css.includes("background: transparent"), true);
});
