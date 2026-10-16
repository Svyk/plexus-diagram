// R4 (zoomNoLayer): a Ctrl/pinch zoom burst does not make the world a will-change layer. A zoom-out scaled the old
// layer before the newly revealed area was rastered (QA5 zoom-out #10: a blank frame 3 ms after the previous one).
import assert from "node:assert/strict";
import test from "node:test";

import { mountBig, settledIn } from "./fixtures/big-mount.js";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const wheel = (m, opts) => m.stub.dispatch(m.view.root, "wheel", { deltaMode: 0, clientX: 700, clientY: 450, ...opts });

for (const [label, flags, zoomLayer] of [["on", {}, ""], ["off", { zoomNoLayer: false }, "transform"]]) {
  test(`R4: zoomNoLayer ${label}: Ctrl-wheel zoom world will-change "${zoomLayer}", a wheel pan keeps the layer`, async () => {
    const m = mountBig({ x: -300, y: -200, zoom: 0.6 }, { flags });
    try {
      await settledIn(m);
      const world = m.view.root.querySelector(".pxd-world");
      const seen = [];
      for (let i = 0; i < 4; i += 1) { wheel(m, { deltaY: 40, ctrlKey: true }); m.stub.flushFrames(); seen.push(world.style.willChange); }
      assert.deepEqual([...new Set(seen)], [zoomLayer], `zoom burst: ${seen}`);
      await tick(400); m.stub.flushTimers(); m.stub.flushFrames();
      await settledIn(m);
      assert.equal(world.style.willChange, "", "the zoom burst closed");
      const pan = [];
      for (let i = 0; i < 4; i += 1) { wheel(m, { deltaX: 80, deltaY: 40 }); m.stub.flushFrames(); pan.push(world.style.willChange); }
      assert.deepEqual([...new Set(pan)], ["transform"], `pan burst: ${pan}`);
      await tick(400); m.stub.flushTimers(); m.stub.flushFrames();
      await settledIn(m);
      assert.equal(world.style.willChange, "");
    } finally {
      m.done();
    }
  });
}
