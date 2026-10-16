// R4: leaving the overview canvas tier built a 30-shell chunk of map shells in one foreground task (QA5 C hand-back at
// 0.3: a 551 ms freeze). With adaptiveSlices the hand-back's chunks start at 12 and double after a short frame.
import assert from "node:assert/strict";
import test from "node:test";

import { missingFrames, mountBig, settledIn } from "./fixtures/big-mount.js";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

async function handBack(flags) {
  const m = mountBig({ x: 300, y: 20, zoom: 0.1 }, { flags: { overviewCanvas: true, ...flags }, fullscreen: true });
  await settledIn(m);
  const frames = [];
  for (let i = 0; i < 7; i += 1) {
    m.stub.dispatch(m.view.root, "wheel", { deltaX: 0, deltaY: -20, ctrlKey: true, deltaMode: 0, clientX: 700, clientY: 450 });
    await tick(16);
    m.stub.flushFrames();
    frames.push(m.view.paintAudit());
  }
  const steps = [];
  let last = m.view.stats().shells;
  for (let i = 0; i < 40; i += 1) {
    await tick(16);
    m.stub.flushTimers();
    m.stub.flushFrames();
    frames.push(m.view.paintAudit());
    const now = m.view.stats().shells;
    if (now > last) steps.push(now - last);
    last = now;
  }
  return { m, steps, frames };
}

test("R4: the hand-back from the overview canvas builds map shells 12 at a time first", async () => {
  const { m, steps, frames } = await handBack({});
  try {
    assert.equal(m.view.state().lod, "map");
    assert.ok(steps.length > 1, `shell builds per frame: ${steps}`);
    assert.ok(steps[0] <= 12, `first hand-back chunk: ${steps}`);
    assert.ok(Math.max(...steps) <= 30, `chunks: ${steps}`);
    assert.deepEqual(missingFrames(frames), []);
  } finally {
    m.done();
  }
});

test("R4: adaptiveSlices off keeps the 30-shell chunk at the hand-back", async () => {
  const { m, steps } = await handBack({ adaptiveSlices: false });
  try {
    assert.ok(steps[0] > 12, `first chunk: ${steps}`);
  } finally {
    m.done();
  }
});
