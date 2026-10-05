import assert from "node:assert/strict";
import test from "node:test";

import { mountMemoryLane } from "../src/view/lane-bar.js";
import { createDomStub } from "./fixtures/dom-stub.js";

test("the start thumb hides the later card, play stops at the end, and a snapshot writes nothing", () => {
  const stub = createDomStub();
  const restore = stub.install();
  const frames = [];
  const previews = [];
  const queued = [];
  try {
    const parent = stub.document.createElement("div");
    stub.document.body.append(parent);
    const start = new Date(2026, 0, 1).getTime();
    const later = new Date(2026, 1, 1).getTime();
    // Frozen inputs: the bar runs in strict mode, so any write into the board data it was given would throw.
    const deepFreeze = (value) => {
      if (value && typeof value === "object" && !Object.isFrozen(value)) {
        Object.freeze(value);
        Object.values(value).forEach(deepFreeze);
      }
      return value;
    };
    const handle = mountMemoryLane({
      doc: stub.document,
      parent,
      now: later,
      items: deepFreeze([{ uid: "a", time: start }, { uid: "b", time: later }]),
      edges: deepFreeze([{ uid: "e", from: "a", to: "b", time: later }]),
      snapshots: deepFreeze([{ title: "Saved", items: [{ uid: "a", x: 10, y: 20, w: 100, h: 40 }] }]),
      onFrame: (frame) => frames.push(frame),
      onPreview: (preview) => previews.push(preview),
      schedule: (fn) => { queued.push(fn); return queued.length; },
      clearTimer() {},
    });
    assert.equal(handle.el.parentElement, parent);
    assert.ok(handle.el.querySelector(".pxd-memory__range"));
    assert.deepEqual(frames[0].future, ["b"]);
    assert.deepEqual(frames[0].hiddenEdges, ["e"]);
    stub.dispatch(handle.el.querySelector(".pxd-memory__tick"), "click");
    assert.equal(previews.length, 1, "one preview, and the frozen inputs were not touched");
    assert.equal(previews[0].layout.get("a").x, 10);
    stub.dispatch(handle.el.querySelector(".pxd-memory__play"), "click");
    assert.equal(handle.el.querySelector(".pxd-memory__play").textContent, "Stop");
    while (queued.length) queued.shift()();
    assert.equal(handle.el.querySelector(".pxd-memory__play").textContent, "Play");
    assert.equal(frames.at(-1).future.length, 0);
    const reduced = mountMemoryLane({
      doc: stub.document,
      parent,
      now: later,
      motion: "reduced",
      items: [{ uid: "a", time: start }, { uid: "b", time: later }],
      onFrame: (frame) => frames.push(frame),
      schedule: (fn) => { queued.push(fn); return 1; },
    });
    const before = frames.length;
    stub.dispatch(reduced.el.querySelector(".pxd-memory__play"), "click");
    assert.equal(queued.length, 0);
    assert.equal(frames.length, before + 1);
    assert.equal(frames.at(-1).future.length, 0);
    handle.close();
    reduced.close();
    assert.equal(handle.el.isConnected, false);
  } finally {
    restore();
  }
});
