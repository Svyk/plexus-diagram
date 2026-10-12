import assert from "node:assert/strict";
import test from "node:test";
import { createPropsPanel } from "../src/view/props-panel.js";
import { createDomStub } from "./fixtures/dom-stub.js";

test("placing the props panel does not read the toolbar's layout on every call", () => {
  const stub = createDomStub();
  const restore = stub.install();
  const observers = [];
  const prevRO = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb; observers.push(this); } observe() {} disconnect() { this.off = true; } };
  try {
    const doc = stub.document;
    const view = doc.defaultView;
    const prevViewRO = view?.ResizeObserver;
    if (view) view.ResizeObserver = globalThis.ResizeObserver;
    const root = doc.createElement("div");
    const tb = doc.createElement("div");
    tb.className = "pxd-toolbar";
    let reads = 0;
    let height = 40;
    Object.defineProperty(tb, "offsetHeight", { get: () => { reads += 1; return height; } });
    root.append(tb);
    doc.body.append(root);
    const panel = createPropsPanel({ doc, root, storage: null });
    const after = reads;
    for (let i = 0; i < 50; i += 1) panel.place();
    assert.equal(reads, after, "no layout read per place()");
    assert.equal(panel.el.style.top, "54px");
    height = 60;
    observers[0].cb([]);
    assert.equal(panel.el.style.top, "74px");
    panel.dispose();
    assert.equal(observers[0].off, true);
    if (view) view.ResizeObserver = prevViewRO;
  } finally {
    globalThis.ResizeObserver = prevRO;
    restore();
  }
});
