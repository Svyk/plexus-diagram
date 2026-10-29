import assert from "node:assert/strict";
import test from "node:test";
import { missingFrames, mountBig, settledIn, tick } from "./fixtures/big-mount.js";

const VARS = { "--pxd-card": "#26333f", "--pxd-border-strong": "#6b7f91", "--pxd-red-line": "#f87171", "--pxd-red-fill": "#3a1f1f", "--pxd-red-text": "#fca5a5", "--pxd-text": "#e5e7eb" };
const titled = (board) => { let i = 0; for (const item of board.items.values()) { if (item.type === "section") continue; item.color = i % 2 ? "red" : ""; item.title = `Card ${i}`; i += 1; } };

// E3-4 (perf2): QA4 C ovmap: inside the zoom burst from 0.1 toward the map tier the canvas drew flat bright overview
// blocks without titles (the tier is held until the settle), then the map shells landed in the dark card look with
// titles: a pop at the hand-back. From 0.2 on the canvas draws the card look of the tier the zoom shows, in the burst.
test("E3-4: in a zoom burst past 0.2 on the overview canvas the boxes are drawn in the map card look with titles, before the tier flips", async () => {
  const m = mountBig({ x: 300, y: 20, zoom: 0.1 }, { flags: { overviewCanvas: true }, fullscreen: true, theme: VARS, prep: titled, virtualClock: true });
  try {
    await settledIn(m);
    const canvas = m.view.root.querySelector(".pxd-underlay");
    const frames = [];
    const looks = [];
    const n0 = m.view.sliceStats().budgets.length;
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
    assert.equal(m.view.sliceStats().budgets[n0], 24, `the hand-back's first slice attaches 24 shells: ${JSON.stringify(m.view.sliceStats().budgets.slice(n0))}`);
    assert.deepEqual(missingFrames(frames), []);
  } finally { m.done(); }
});

import { dragSelection } from "./fixtures/big-mount.js";

// E3-6 (perf2): dragLayer gave no gain live (p50 232 vs 218 ms): the crossing edges were re-pathed inside the edges
// <svg>, so every drag frame repainted all ~2,000 paths. They ride their own layer for the drag now.
const dWritesByLayer = (root) => {
  const counts = new Map();
  for (const path of root.querySelectorAll("path")) {
    const set = path.setAttribute.bind(path);
    path.setAttribute = (name, value) => {
      if (name === "d") {
        let n = path.parentElement;
        while (n && !String(n.getAttribute?.("class") || "").startsWith("pxd-edges")) n = n.parentElement;
        const key = n ? String(n.getAttribute("class")) : "?";
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      return set(name, value);
    };
  }
  return counts;
};
test("E3-6: during a big drag no path in the main edges layer is rewritten; crossing edges are re-pathed in their own layer, and go back at the drop", async () => {
  const { m, root, el, p } = await dragSelection({ overviewCanvas: false });
  try {
    m.stub.dispatch(el, "pointerdown", { ...p, button: 0, buttons: 1, pointerId: 7 });
    for (let i = 1; i <= 2; i += 1) {
      m.stub.dispatch(el, "pointermove", { clientX: p.clientX + i * 3, clientY: p.clientY + i * 2, buttons: 1, pointerId: 7 });
      m.stub.flushFrames();
    }
    const cross = root.querySelector(".pxd-edges--cross");
    assert.ok(cross && cross.children.length > 0, "crossing edges ride their own layer");
    const counts = dWritesByLayer(root);
    for (let i = 3; i <= 8; i += 1) {
      m.stub.dispatch(el, "pointermove", { clientX: p.clientX + i * 3, clientY: p.clientY + i * 2, buttons: 1, pointerId: 7 });
      m.stub.flushFrames();
    }
    assert.equal(counts.get("pxd-edges") || 0, 0, `d writes in the main edges layer during the drag: ${JSON.stringify([...counts])}`);
    assert.ok((counts.get("pxd-edges pxd-edges--cross") || 0) > 0, `crossing edges follow: ${JSON.stringify([...counts])}`);
    const kids = [...cross.children];
    m.stub.dispatch(el, "pointerup", { clientX: p.clientX + 24, clientY: p.clientY + 16, button: 0, buttons: 0, pointerId: 7 });
    assert.equal(root.querySelector(".pxd-edges--cross"), null, "the crossing layer is gone in the drop's task");
    assert.ok(kids.every((g) => g.closest("svg")?.getAttribute("class") === "pxd-edges"), "crossing edges are back in the edges layer");
  } finally { m.done(); }
});
