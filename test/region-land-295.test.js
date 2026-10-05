// REG-5 / REG-7. Crop and view frames stop the pointer, and the landing camera pins the region.
import assert from "node:assert/strict";
import test from "node:test";

import { cameraRectOf, regionCamera, setCameraFromView } from "../src/view/region-hover-geom.js";
import { mountRegionCrop, openRegionView } from "../src/view/region-crop.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const frac = { rx: 0.25, ry: 0.3, rw: 0.2, rh: 0.25 };
const region = { kind: "img", drawingUid: "imgBlock1", caption: "hamstring", f: frac, owner: "plexus-diagram", supported: true };

function stops(stub, node) {
  for (const type of ["pointerdown", "mousedown", "mouseup", "dblclick"]) {
    const event = stub.dispatch(node, type);
    assert.equal(event.propagationStopped, true, type);
  }
}

test("REG-5: a crop with onOpen is focusable, stops the pointer, and opens on click", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const button = stub.document.createElement("button");
    button.textContent = "plexus-region";
    stub.document.body.append(button);
    let opened = null;
    const handle = mountRegionCrop({
      doc: stub.document,
      button,
      region,
      file: null,
      onOpen: (ev) => { opened = ev; },
    });
    assert.equal(handle.el.tabIndex, 0);
    stops(stub, handle.el);
    const click = stub.dispatch(handle.el, "click", { shiftKey: true });
    assert.equal(click.defaultPrevented, true);
    assert.equal(opened.shiftKey, true);
    const plain = stub.dispatch(handle.el, "click", { shiftKey: false });
    assert.equal(plain.defaultPrevented, true);
    assert.equal(opened.shiftKey, false);
    handle.destroy();
  } finally {
    restore();
  }
});

test("REG-7: the view frame is inline-block and stops the pointer", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const button = stub.document.createElement("button");
    button.textContent = "plexus-region";
    stub.document.body.append(button);
    const board = {
      uid: "board1",
      items: new Map([
        ["card1", { uid: "card1", type: "card", parentUid: "board1", x: 0, y: 0, w: 40, h: 20, title: "Card" }],
      ]),
    };
    let opened = null;
    const handle = openRegionView({
      doc: stub.document,
      button,
      region: { kind: "view", drawingUid: "board1", caption: "Corner", v: [0, 0, 80, 40], ids: ["card1"] },
      loadBoard: () => board,
      onOpen: (ev) => { opened = ev; },
    });
    assert.equal(button.getAttribute("data-plexus-owner"), "plexus-diagram");
    await handle.pending;
    const frame = stub.document.querySelector(".pxd-region-view");
    assert.equal(frame.style.display, "inline-block");
    assert.equal(frame.tabIndex, 0);
    stops(stub, frame);
    const click = stub.dispatch(frame, "click", { shiftKey: true });
    assert.equal(click.defaultPrevented, true);
    assert.equal(opened.shiftKey, true);
    handle.destroy();
    assert.equal(button.style.display, "");
  } finally {
    restore();
  }
});

test("REG-5: leaving the crop does not close the popover, and a removed popover opens again", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const button = stub.document.createElement("button");
    button.textContent = "plexus-region";
    stub.document.body.append(button);
    const handle = mountRegionCrop({
      doc: stub.document,
      button,
      region,
      file: null,
      delayMs: 0,
      buildPopover(el) { el.textContent = "Open"; },
    });
    stub.dispatch(handle.el, "mouseenter");
    assert.equal(stub.flushTimers(), 1);
    const first = stub.document.querySelector(".pxd-region-pop");
    assert.equal(first?.isConnected, true);
    stub.dispatch(handle.el, "mouseleave", { relatedTarget: stub.document.body });
    assert.equal(first.isConnected, true);
    first.remove();
    assert.equal(first.isConnected, false);
    stub.dispatch(handle.el, "mouseenter");
    stub.flushTimers();
    const pops = stub.document.querySelectorAll(".pxd-region-pop").filter((el) => el.isConnected);
    assert.equal(pops.length, 1);
    assert.notEqual(pops[0], first);
    handle.destroy();
    assert.equal(stub.document.querySelector(".pxd-region-pop"), null);
  } finally {
    restore();
  }
});

test("REG-5: setCameraFromView pins v and cameraRectOf contains that rect", () => {
  const size = { width: 800, height: 600 };
  const cam = setCameraFromView([10, 20, 400, 300], size);
  assert.equal(cam.zoom, 2);
  assert.equal(cam.x, -10 * cam.zoom);
  assert.equal(cam.y, -20 * cam.zoom);
  assert.deepEqual(cameraRectOf(cam, size), { x: 10, y: 20, w: 400, h: 300 });
});

test("REG-5: regionCamera zooms a full image box by its smaller side", () => {
  const full = regionCamera({
    imageRect: { x: 0, y: 0, w: 100, h: 80 },
    frac: [0, 0, 1, 1],
    size: { width: 240, height: 240 },
  });
  assert.equal(full.zoom, 3);
  const forty = regionCamera({
    imageRect: { x: 0, y: 0, w: 40, h: 40 },
    frac: [0, 0, 1, 1],
    size: { width: 800, height: 600 },
  });
  assert.equal(forty.zoom, 4);
});
