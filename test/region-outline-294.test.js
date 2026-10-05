// REG-3: the outline overlay tracks the image and does not write the graph.
import assert from "node:assert/strict";
import test from "node:test";

import { mountOutlineRegion } from "../src/view/region-outline.js";
import { createDomStub } from "./fixtures/dom-stub.js";

function rect(x, y, width, height) {
  return { x, y, left: x, top: y, width, height, right: x + width, bottom: y + height };
}

function mount(box = rect(314.2, 161, 500, 312.5)) {
  const stub = createDomStub();
  const restore = stub.install();
  const img = stub.document.createElement("img");
  img.className = "rm-inline-img";
  img._rect = box;
  stub.document.body.append(img);
  return { stub, restore, img, box };
}

const at = (img, px, py) => [img._rect.x + img._rect.width * px, img._rect.y + img._rect.height * py];

test("REG-3: the fixed root matches the image box and overflow stays visible", () => {
  const { stub, restore, img, box } = mount();
  try {
    const handle = mountOutlineRegion({ doc: stub.document, img, onConfirm() {}, onCancel() {} });
    const root = stub.document.querySelector(".pxd-root");
    assert.equal(root.style.position, "fixed");
    assert.equal(root.style.left, `${box.left}px`);
    assert.equal(root.style.top, `${box.top}px`);
    assert.equal(root.style.width, `${box.width}px`);
    assert.equal(root.style.height, `${box.height}px`);
    assert.equal(root.style.overflow, "visible");
    assert.notEqual(root.style.height, "560px");
    assert.equal(root.querySelector(".pxd-region-layer") != null, true);
    handle.destroy();
    assert.equal(stub.pxdNodes().length, 0);
  } finally {
    restore();
  }
});

test("REG-3: confirm reports the drag fraction and removes the overlay", () => {
  const { stub, restore, img } = mount(rect(40, 80, 200, 100));
  const seen = [];
  try {
    mountOutlineRegion({
      doc: stub.document,
      img,
      onConfirm: (value) => seen.push(value),
      onCancel: () => seen.push("cancel"),
    });
    const root = stub.document.querySelector(".pxd-root");
    root._rect = img._rect;
    const layer = root.querySelector(".pxd-region-layer");
    const [x0, y0] = at(img, 0.25, 0.3);
    const [x1, y1] = at(img, 0.45, 0.55);
    let captured = false;
    layer.setPointerCapture = () => { captured = true; };
    stub.dispatch(layer, "pointerdown", { clientX: x0, clientY: y0, button: 0 });
    stub.dispatch(stub.document, "pointermove", { clientX: x1, clientY: y1 });
    stub.dispatch(stub.document, "pointerup", { clientX: x1, clientY: y1 });
    root.querySelector(".pxd-region-caption").value = "hamstring";
    root.querySelector(".pxd-region-confirm").click();
    assert.equal(captured, false);
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0].frac, { rx: 0.25, ry: 0.3, rw: 0.2, rh: 0.25 });
    assert.equal(seen[0].caption, "hamstring");
    assert.equal(stub.pxdNodes().length, 0);
  } finally {
    restore();
  }
});

test("REG-3: Escape removes the overlay and writes nothing", () => {
  const { stub, restore, img } = mount();
  const seen = [];
  try {
    mountOutlineRegion({ doc: stub.document, img, onConfirm: () => seen.push("confirm"), onCancel: () => seen.push("cancel") });
    stub.dispatch(stub.document, "keydown", { key: "Escape" });
    assert.deepEqual(seen, ["cancel"]);
    assert.equal(stub.pxdNodes().length, 0);
  } finally {
    restore();
  }
});

test("REG-3: a click outside waits one turn, then removes the overlay", async () => {
  const { stub, restore, img } = mount();
  const seen = [];
  try {
    mountOutlineRegion({ doc: stub.document, img, onConfirm: () => seen.push("confirm"), onCancel: () => seen.push("cancel") });
    stub.dispatch(stub.document.body, "pointerdown", { button: 0 });
    assert.equal(stub.document.querySelector(".pxd-root") != null, true);
    assert.deepEqual(seen, []);
    await new Promise((resolve) => setTimeout(resolve, 0));
    stub.dispatch(stub.document.body, "pointerdown", { button: 0 });
    assert.deepEqual(seen, ["cancel"]);
    assert.equal(stub.pxdNodes().length, 0);
  } finally {
    restore();
  }
});

test("REG-3: scroll moves the root, and a disconnected image destroys it", () => {
  const { stub, restore, img } = mount();
  let cancelled = 0;
  try {
    mountOutlineRegion({ doc: stub.document, img, onCancel: () => { cancelled += 1; } });
    img._rect = rect(20, 30, 500, 312.5);
    stub.dispatch(stub.document, "scroll", {});
    const root = stub.document.querySelector(".pxd-root");
    assert.equal(root.style.left, "20px");
    assert.equal(root.style.top, "30px");
    img.remove();
    stub.dispatch(stub.document, "scroll", {});
    assert.equal(cancelled, 1);
    assert.equal(stub.pxdNodes().length, 0);
  } finally {
    restore();
  }
});
