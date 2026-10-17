// PERF5-P1: view.typingProfile() reads Event Timing + Long Animation Frames, so a live run names who spent each key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mountBig } from "./fixtures/big-mount.js";

class FakePO {
  static all = [];
  constructor(cb) { this.cb = cb; this.type = ""; FakePO.all.push(this); }
  observe(o) { this.type = o.type; this.opts = o; }
  disconnect() { this.gone = true; }
  feed(entries) { this.cb({ getEntries: () => entries }); }
}

test("P1: typingProfile arms event + long-animation-frame observers, then splits each key into delay, handlers and presentation", async () => {
  const realPO = globalThis.PerformanceObserver;
  globalThis.PerformanceObserver = FakePO;
  FakePO.all = [];
  const m = mountBig({ x: 0, y: 0, zoom: 1 });
  try {
    const armed = m.view.typingProfile();
    assert.equal(armed.armed, true);
    const ev = FakePO.all.find((o) => o.type === "event" && !o.gone);
    const lf = FakePO.all.find((o) => o.type === "long-animation-frame" && !o.gone);
    assert.ok(ev && lf, "both observers armed");
    assert.equal(ev.opts.durationThreshold, 16);
    const t = performance.now();
    ev.feed([
      { name: "keydown", startTime: t + 10, processingStart: t + 12, processingEnd: t + 20, duration: 220 },
      { name: "keydown", startTime: t + 300, processingStart: t + 301, processingEnd: t + 311, duration: 200 },
      { name: "pointerdown", startTime: t + 400, processingStart: t + 401, processingEnd: t + 402, duration: 40 },
    ]);
    lf.feed([{ startTime: t + 10, duration: 210, blockingDuration: 160, renderStart: t + 120, styleAndLayoutStart: t + 130,
      scripts: [
        { sourceURL: "https://roamresearch.com/js/main.js?v=1", sourceFunctionName: "onChange", invokerType: "event-listener", invoker: "TEXTAREA.oninput", duration: 90, forcedStyleAndLayoutDuration: 80 },
        { sourceURL: "https://roamresearch.com/js/main.js?v=1", sourceFunctionName: "onChange", invokerType: "event-listener", invoker: "TEXTAREA.oninput", duration: 10, forcedStyleAndLayoutDuration: 5 },
      ] }]);
    const s = m.view.typingProfile();
    assert.equal(s.keys, 2);
    assert.equal(s.key.ms, 220);
    assert.equal(s.events.find((e) => e.type === "keydown").handlers, 8);
    assert.equal(s.events.find((e) => e.type === "keydown").present, 210);
    assert.equal(s.frames.n, 1);
    assert.equal(s.frames.render, 100);
    assert.equal(s.frames.styleLayout, 90);
    assert.equal(s.scripts[0].src, "main.js");
    assert.equal(s.scripts[0].ms, 100);
    assert.equal(s.scripts[0].forcedMs, 85);
    assert.equal(s.scripts[0].n, 2);
    const again = m.view.typingProfile({ reset: true });
    assert.equal(again.armed, true);
    assert.ok(ev.gone && lf.gone, "reset disconnects the old observers");
  } finally {
    m.done();
    globalThis.PerformanceObserver = realPO;
  }
  assert.ok(FakePO.all.every((o) => o.gone), "dispose disconnects every observer");
});
