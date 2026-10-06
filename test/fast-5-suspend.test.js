// FAST-5: a suspended board view disconnects its observers and ignores input.
import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { mountBoardView } from "../src/view/board-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const raw = {
  ":block/uid": "board0001",
  ":block/string": "{{[[diagram]]:Test}}",
  ":block/props": { ":plexus": { ":v": 2 } },
  ":block/children": [
    { ":block/uid": "cardAAAA1", ":block/string": "Alpha", ":block/order": 0, ":block/props": { ":plexus": { ":x": 0, ":y": 0, ":w": 200, ":h": 100 } }, ":block/children": [] },
  ],
};

function sessionFor(board) {
  const base = {
    uid: board.uid,
    board,
    rects: worldRects(board),
    links: [],
    coveredEdges: new Set(),
    on() { return () => {}; },
  };
  return new Proxy(base, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === "symbol") return undefined;
      return () => {};
    },
  });
}

function hostFor() {
  return {
    graph: "Readwisenotes",
    renderString(el, string) { el.textContent = string; },
    renderBlock() {},
    renderPage() {},
    unmount() {},
    pagePreview: () => ({ exists: false, blocks: [] }),
    pullTree: () => [],
    blockString: () => null,
  };
}

function mount(stub) {
  const doc = stub.document;
  const mountEl = doc.createElement("div");
  mountEl.className = "pxd-mount";
  doc.body.append(mountEl);
  const ros = [];
  const mos = [];
  const RO = globalThis.ResizeObserver;
  const MO = globalThis.MutationObserver;
  globalThis.ResizeObserver = class extends RO {
    constructor(cb) {
      super(cb);
      this.seen = [];
      const orig = this.observe.bind(this);
      this.observe = (target, options) => {
        this.seen.push(target);
        return orig(target, options);
      };
      ros.push(this);
    }
  };
  globalThis.MutationObserver = class extends MO {
    constructor(cb) { super(cb); mos.push(this); }
  };
  const view = mountBoardView({
    host: hostFor(),
    session: sessionFor(buildBoard(raw)),
    mountEl,
    settings: { get: () => undefined },
    version: "2.17.0",
  });
  return { view, mountEl, ros, mos };
}

test("suspend disconnects observers and ignores key, pointer, and wheel", () => {
  const stub = createDomStub();
  const restore = stub.install();
  let view = null;
  try {
    const mounted = mount(stub);
    view = mounted.view;
    stub.flushFrames();
    stub.flushIdle();
    stub.flushFrames();
    assert.equal(stub.frames.length, 0);

    const ro = mounted.ros.find((obs) => obs.seen?.includes(mounted.view.root));
    const mo = mounted.mos.find((obs) => obs.targets?.some((row) => row.target === stub.document.documentElement));
    assert.ok(ro, "the view observes its root");
    assert.ok(mo, "the view observes the document theme");
    assert.equal(mo.targets.length, 2);

    const calls = { n: 0 };
    const orig = view.controller.handle.bind(view.controller);
    view.controller.handle = (ev) => { calls.n += 1; return orig(ev); };
    view.root.focus();
    stub.dispatch(view.root, "keydown", { key: "ArrowLeft", code: "ArrowLeft" });
    stub.dispatch(view.root, "pointerdown", { button: 0, buttons: 1, pointerId: 1 });
    stub.dispatch(view.root, "wheel", { deltaY: 40 });
    assert.equal(calls.n, 3, "a live board handles key, pointer, and wheel");

    view.suspend();
    view.suspend();
    assert.equal(ro.active, false);
    assert.equal(mo.active, false);
    assert.equal(mo.targets.length, 0);
    assert.equal(stub.frames.length, 0);
    stub.dispatch(view.root, "keydown", { key: "ArrowLeft", code: "ArrowLeft" });
    stub.dispatch(view.root, "pointerdown", { button: 0, buttons: 1, pointerId: 1 });
    stub.dispatch(view.root, "wheel", { deltaY: 40 });
    assert.equal(calls.n, 3, "a suspended board handles none of them");

    view.resume();
    assert.equal(ro.active, true);
    assert.equal(mo.active, true);
    assert.equal(mo.targets.length, 2);
    assert.ok(mo.targets.some((row) => row.target === stub.document.documentElement));
    assert.ok(mo.targets.some((row) => row.target === stub.document.body));
    assert.equal(stub.frames.length, 1, "resume queues one repaint");
    stub.flushFrames();
    stub.dispatch(view.root, "keydown", { key: "ArrowLeft", code: "ArrowLeft" });
    assert.equal(calls.n, 4);

    view.restoreViewport({ x: 40, y: 50, zoom: 1.5 });
    assert.deepEqual(view.viewport(), { x: 40, y: 50, zoom: 1.5 });
    view.restoreViewport({ x: 1, y: 2, zoom: 0 });
    assert.deepEqual(view.viewport(), { x: 40, y: 50, zoom: 1.5 });
  } finally {
    try { view?.dispose(); } catch { /* already gone */ }
    restore();
  }
});

test("dispose of a suspended view removes the root and its listeners", () => {
  const stub = createDomStub();
  const restore = stub.install();
  let view = null;
  try {
    const before = stub.listenerCount();
    const mounted = mount(stub);
    view = mounted.view;
    stub.flushFrames();
    assert.ok(stub.listenerCount() > before);
    assert.equal(view.root.isConnected, true);
    view.suspend();
    view.dispose();
    view = null;
    assert.equal(mounted.view.root.isConnected, false);
    assert.equal(stub.listenerCount(), before);
    assert.equal(mounted.ros.some((obs) => obs.active), false);
    assert.equal(mounted.mos.some((obs) => obs.active), false);
  } finally {
    try { view?.dispose(); } catch { /* already gone */ }
    restore();
  }
});
