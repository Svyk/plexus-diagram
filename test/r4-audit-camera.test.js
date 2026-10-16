// R4: view.paintAudit() measures the frame the browser paints. A wheel event moves `vp` at once, and the frame's
// render (world transform, reveal, underlay) runs later in a rAF. QA sampled the audit in its own rAF callback, which
// runs before the view's, and counted cards the camera had just brought in as missing (QA5: B panfit 45 in the first
// five frames, zoom-out 5) though the frame that painted had them.
import assert from "node:assert/strict";
import test from "node:test";

import { mountBig, settledIn } from "./fixtures/big-mount.js";

test("R4: paintAudit between a wheel event and its render frame counts the camera the DOM shows", async () => {
  const m = mountBig({ x: -300, y: -200, zoom: 0.6 }, { flags: { overviewCanvas: false } });
  try {
    await settledIn(m);
    const world = m.view.root.querySelector(".pxd-world");
    const shown = world.style.transform;
    const before = m.view.paintAudit();
    assert.equal(before.missing, 0, JSON.stringify(before));
    m.stub.dispatch(m.view.root, "wheel", { deltaX: 1200, deltaY: 800, deltaMode: 0, clientX: 700, clientY: 450 });
    assert.equal(world.style.transform, shown, "the transform waits for the render frame");
    const mid = m.view.paintAudit();
    assert.equal(mid.missing, 0, `between input and render: ${JSON.stringify(mid)}`);
    m.stub.flushFrames();
    assert.notEqual(world.style.transform, shown);
    const after = m.view.paintAudit();
    assert.equal(after.missing, 0, `after the render frame: ${JSON.stringify(after)}`);
  } finally {
    m.done();
  }
});
