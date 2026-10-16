import assert from "node:assert/strict";
import test from "node:test";
import { missingFrames, mountBig, settledIn } from "./fixtures/big-mount.js";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const VARS = { "--pxd-card": "#26333f", "--pxd-border-strong": "#6b7f91", "--pxd-red-line": "#f87171", "--pxd-red-fill": "#3a1f1f", "--pxd-red-text": "#fca5a5", "--pxd-text": "#e5e7eb" };
const titled = (board) => { let i = 0; for (const item of board.items.values()) { if (item.type === "section") continue; item.color = i % 2 ? "red" : ""; item.title = `Card ${i}`; i += 1; } };

// E3-4 (perf2): QA4 C ovmap: inside the zoom burst from 0.1 toward the map tier the canvas drew flat bright overview
// blocks without titles (the tier is held until the settle), then the map shells landed in the dark card look with
// titles: a pop at the hand-back. From 0.2 on the canvas draws the card look of the tier the zoom shows, in the burst.
test("E3-4: in a zoom burst past 0.2 on the overview canvas the boxes are drawn in the map card look with titles, before the tier flips", async () => {
  const m = mountBig({ x: 300, y: 20, zoom: 0.1 }, { flags: { overviewCanvas: true }, fullscreen: true, theme: VARS, prep: titled });
  try {
    await settledIn(m);
    const canvas = m.view.root.querySelector(".pxd-underlay");
    const frames = [];
    const looks = [];
    for (let i = 0; i < 6; i += 1) {
      m.stub.dispatch(m.view.root, "wheel", { deltaX: 0, deltaY: -20, ctrlKey: true, deltaMode: 0, clientX: 700, clientY: 450 });
      await tick(16);
      m.stub.flushFrames();
      frames.push(m.view.paintAudit());
      const ops = canvas.__ctx.ops.map((op) => op.join(" "));
      looks.push({ zoom: m.view.viewport().zoom, lod: m.view.state().lod, card: ops.includes("fill #26333f"), title: ops.some((op) => op.startsWith("fillText")), block: ops.includes("fillRect #f87171") });
    }
    const past = looks.filter((l) => l.zoom >= 0.2 * 1.05);
    assert.ok(past.length >= 2, `burst frames past 0.2: ${JSON.stringify(looks)}`);
    assert.ok(past.every((l) => l.lod === "overview"), "the tier is still held in the burst");
    assert.ok(past.every((l) => l.card && l.title && !l.block), `card look with titles in the burst: ${JSON.stringify(past)}`);
    const below = looks.filter((l) => l.zoom < 0.2);
    assert.ok(below.every((l) => l.block && !l.card), `overview look below 0.2: ${JSON.stringify(below)}`);
    for (let i = 0; i < 60; i += 1) { await tick(16); m.stub.flushTimers(); m.stub.flushFrames(); m.stub.flushIdle(); frames.push(m.view.paintAudit()); }
    assert.equal(m.view.state().lod, "map");
    assert.deepEqual(missingFrames(frames), []);
  } finally { m.done(); }
});
