// verify 3.28: the board view hands a held arrow's repeat flag to the controller (P5-B held-arrow coalescing).
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

test("a held arrow's repeat keydowns reach the controller as repeats", () => {
  const stub = createDomStub();
  const restore = stub.install();
  let view = null;
  try {
    view = mount(stub).view;
    stub.flushFrames();
    const seen = [];
    const orig = view.controller.handle.bind(view.controller);
    view.controller.handle = (ev) => { if (ev.type === "keydown") seen.push(ev.repeat === true); return orig(ev); };
    view.root.focus();
    stub.dispatch(view.root, "keydown", { key: "ArrowRight", code: "ArrowRight" });
    stub.dispatch(view.root, "keydown", { key: "ArrowRight", code: "ArrowRight", repeat: true });
    stub.dispatch(view.root, "keydown", { key: "ArrowRight", code: "ArrowRight", repeat: true });
    assert.deepEqual(seen, [false, true, true]);
  } finally {
    try { view?.dispose?.(); } catch { /* gone */ }
    restore();
  }
});
