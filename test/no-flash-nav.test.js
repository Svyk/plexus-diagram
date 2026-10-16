import assert from "node:assert/strict";
import test from "node:test";
import { dragSelection, missingFrames, mountBig, riders, settledIn, withFrozenClock, zoomBurst } from "./fixtures/big-mount.js";

// perf2 lane E: no-flash navigation and tier flips on the 1,560-card fixture, through the view's real entry points.
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));


test("E1: a parked fullscreen board lets go of the mount's chrome observers, takes them back on unpark, and its dispose leaves the mount fullscreen", async () => {
  const m = mountBig({ x: 0, y: 0, zoom: 1 }, { fullscreen: true });
  try {
    await m.pump(4);
    assert.ok(m.mountEl.classList.contains("pxd-mount--fullscreen"));
    m.view.suspend();
    assert.equal(m.view.park(), true);
    m.view.unpark();
    m.view.resume();
    assert.ok(m.mountEl.classList.contains("pxd-mount--fullscreen"), "still fullscreen after the way back");
    m.view.suspend();
    m.view.park();
    // Another board shows fullscreen in this mount now; the parked one is dropped from the pool.
    m.view.dispose();
    assert.ok(m.mountEl.classList.contains("pxd-mount--fullscreen"), "disposing a parked board does not undo the mount's fullscreen");
  } finally { m.done(); }
});

// The cover (queued cards of an overview-fast open) and the burst underlay drew every card as a plain --pxd-card box.
// On a coloured board that reads as the cards vanishing (QA1 Part C #1, C-crumb-044: grey boxes after the snapshot).
const VARS = {
  "--pxd-card": "#26333f", "--pxd-border-strong": "#6b7f91",
  "--pxd-red-line": "#f87171", "--pxd-red-fill": "transparent",
  "--pxd-teal-line": "#2dd4bf", "--pxd-teal-fill": "#f0fdfa", "--pxd-muted": "#8899aa",
};
const colourCards = (board) => {
  let i = 0;
  for (const item of board.items.values()) {
    if (item.type === "section") continue;
    item.color = i % 3 === 0 ? "red" : i % 3 === 1 ? "teal" : "";
    i += 1;
  }
};

test("styledUnderlay: the open cover draws queued cards the way the cards look (card fill, palette fill, palette border)", async () => {
  await withFrozenClock(async () => {
    const m = mountBig({ x: 0, y: 0, zoom: 0.3 }, { theme: VARS, prep: colourCards });
    try {
      m.stub.flushFrames();
      const canvas = m.view.root.querySelector(".pxd-underlay");
      assert.ok(canvas && canvas.style.display !== "none", "queued cards are covered");
      const ops = canvas.__ctx.ops.map((op) => op.join(" "));
      assert.ok(ops.includes("fill #26333f"), `card fill: ${ops.slice(0, 8)}`);
      assert.ok(ops.includes("fill #f0fdfa"), "teal palette fill over it");
      assert.ok(ops.includes("stroke #f87171") && ops.includes("stroke #2dd4bf") && ops.includes("stroke #6b7f91"), "borders in the card's line colour");
      assert.ok(ops.includes("stroke #8899aa"), "arrows held back for a queued end are hairlines (the snapshot drew them)");
    } finally { m.done(); }
  });
});

test("styledUnderlay: at overview the cover fills a coloured card with its line colour, as the overview CSS does", async () => {
  await withFrozenClock(async () => {
    const m = mountBig({ x: 300, y: 20, zoom: 0.1 }, { theme: VARS, prep: colourCards });
    try {
      m.stub.flushFrames();
      assert.equal(m.view.state().lod, "overview");
      const canvas = m.view.root.querySelector(".pxd-underlay");
      assert.ok(canvas && canvas.style.display !== "none", "queued cards are covered");
      const ops = canvas.__ctx.ops.map((op) => op.join(" "));
      assert.ok(ops.includes("fillRect #f87171") && ops.includes("fillRect #2dd4bf"), `line-colour boxes: ${ops.slice(0, 6)}`);
      assert.ok(ops.includes("fillRect #26333f"), "an uncoloured card is the card colour");
    } finally { m.done(); }
  });
});

test("styledUnderlay off draws the 3.34.0 plain boxes", async () => {
  await withFrozenClock(async () => {
    const m = mountBig({ x: 0, y: 0, zoom: 0.3 }, { flags: { styledUnderlay: false }, theme: VARS, prep: colourCards });
    try {
      m.stub.flushFrames();
      const ops = m.view.root.querySelector(".pxd-underlay").__ctx.ops.map((op) => op.join(" "));
      assert.ok(ops.length > 0 && ops.every((op) => op === "fillRect #26333f"), `plain: ${ops.slice(0, 4)}`);
    } finally { m.done(); }
  });
});


test("E2: a zoom-out from detail to overview shows every in-view card in every frame, and the burst closes", async () => {
  for (const flags of [{}, { overviewCanvas: true }]) {
    const m = mountBig({ x: -2000, y: -1500, zoom: 1 }, { flags });
    try {
      await settledIn(m);
      const frames = await zoomBurst(m, 1, 14);
      assert.equal(m.view.state().lod, "overview");
      assert.deepEqual(missingFrames(frames), [], `frames with cards in neither a shell nor a box (${JSON.stringify(flags)})`);
      assert.equal(m.view.root.querySelector(".pxd-world").style.willChange, "", "the wheel burst closed after the zoom gesture");
      if (flags.overviewCanvas) assert.ok(m.view.overviewCanvasStats().shown, "the overview canvas shows the cards");
      else assert.equal(frames.at(-1).attached, frames.at(-1).inView, "every in-view shell is attached in the end");
    } finally { m.done(); }
  }
});

test("E3: a zoom-in from overview to detail shows every in-view card in every frame, and the flip restyles only near shells", async () => {
  const m = mountBig({ x: 300, y: 20, zoom: 0.1 });
  try {
    await settledIn(m);
    const frames = await zoomBurst(m, -1, 16);
    assert.equal(m.view.state().lod, "detail");
    assert.deepEqual(missingFrames(frames), []);
    const at = m.view.flipStats().attachedAtFlip.at(-1);
    assert.ok(at <= 120, `attached shells when the tier flipped: ${at}`);
  } finally { m.done(); }
});

// Crumb back to a kept big board (feature.js reattach: unpark, resume). With shells still queued the resume ran the
// full pass, which re-pathed every edge (QA1 Part C #1: 1,936 `d` rewrites per edge part, 3,766 data-uid rewrites).
test("E1: resuming a parked big board with shells still queued re-places no edge, keeps every edge element, and paints every in-view card", async () => {
  {
    for (const vp of [{ x: 300, y: 20, zoom: 0.1 }, { x: 0, y: 0, zoom: 0.3 }]) {
      const m = mountBig(vp);
      try {
        await m.pump(30);
        assert.ok(m.view.stats().shells < 1570, "shells are still queued when the board parks");
        const before = m.view.stats();
        const els = new Set(m.view.root.querySelectorAll(".pxd-edge"));
        assert.ok(els.size > 0);
        m.view.suspend();
        assert.equal(m.view.park(), true);
        m.view.unpark();
        m.view.resume();
        for (let i = 0; i < 6; i += 1) {
          m.stub.flushFrames();
          await null;
          const f = m.view.paintAudit();
          assert.equal(f.missing, 0, `frame ${i} at zoom ${vp.zoom}: ${f.attached} shells + ${f.covered} boxes of ${f.inView}`);
        }
        assert.equal(m.view.stats().edgePlacements, before.edgePlacements, "no edge is re-placed");
        const after = new Set(m.view.root.querySelectorAll(".pxd-edge"));
        assert.equal([...els].filter((el) => !after.has(el)).length, 0, "every edge element is the same one");
      } finally { m.done(); }
    }
  }
});

test("E5: no background slice runs inside a wheel burst on the board; it runs once the settle has been quiet", async () => {
  const { bindBgGestureFlag, resetSharedBgBudget, sharedBgBudget, BG_QUIET_MS } = await import("../src/bg-budget.js");
  for (const on of [true, false]) {
    bindBgGestureFlag(() => on);
    resetSharedBgBudget();
    const m = mountBig({ x: 0, y: 0, zoom: 0.3 });
    try {
      await settledIn(m);
      await tick(600);
      const runs = [];
      let inBurst = false;
      m.stub.dispatch(m.view.root, "wheel", { deltaX: 30, deltaY: 30, deltaMode: 0, clientX: 700, clientY: 450 });
      m.stub.flushFrames();
      sharedBgBudget().idle(() => { runs.push(inBurst); }, { label: "test" });
      const t0 = Date.now();
      while (Date.now() - t0 < 700) {
        inBurst = true;
        m.stub.dispatch(m.view.root, "wheel", { deltaX: 30, deltaY: 30, deltaMode: 0, clientX: 700, clientY: 450 });
        m.stub.flushFrames();
        m.stub.flushIdle();
        await tick(16);
      }
      inBurst = false;
      const t1 = Date.now();
      while (!runs.length && Date.now() - t1 < 2500) { await tick(30); m.stub.flushTimers(); m.stub.flushFrames(); m.stub.flushIdle(); }
      if (on) {
        assert.deepEqual(runs, [false], "the job ran once, after the burst");
        assert.ok(Date.now() - t1 >= 120 + BG_QUIET_MS - 40, `not before the settle's quiet (${Date.now() - t1} ms)`);
      } else assert.equal(runs[0], true, "flag off: the 3.34.0 budget ran it inside the burst");
    } finally { m.done(); bindBgGestureFlag(() => false); resetSharedBgBudget(); }
  }
});

// QA1 Part B row 2: a drag of 185 selected cards at overview, p95 333 ms. The edges inside the moving set ride one
// layer (one transform a frame), the moving shells get their own compositor layers, and only the crossing edges near
// the view are placed (at most 300 a frame). The drop places the riders at the committed spot in the same task.

test("E6: a big selection drags as one layer: inner edges ride it untouched, crossing edges are budgeted, the drop places everything in one task", async () => {
  const { m, root, sel, el, p } = await dragSelection({});
  try {
    assert.ok(sel.length >= 24, `selected ${sel.length}`);
    m.stub.dispatch(el, "pointerdown", { ...p, button: 0, buttons: 1, pointerId: 7 });
    const perFrame = [];
    let before = null;
    let layerD = null;
    for (let i = 1; i <= 10; i += 1) {
      const p0 = m.view.stats().edgePlacements;
      m.stub.dispatch(el, "pointermove", { clientX: p.clientX + i * 3, clientY: p.clientY + i * 2, buttons: 1, pointerId: 7 });
      m.stub.flushFrames();
      perFrame.push(m.view.stats().edgePlacements - p0);
      const layer = riders(root);
      if (layer && !before) {
        before = [...layer.children].map((g) => [g, g.querySelector?.(".pxd-edge__line")?.getAttribute("d") ?? g.children?.[1]?.getAttribute?.("d")]);
        layerD = before.map(([, d]) => d);
      }
    }
    const layer = riders(root);
    assert.ok(layer && layer.children.length > 0, "the inner edges ride the drag layer");
    assert.match(layer.style.transform, /^translate\(/);
    assert.deepEqual(before.map(([g]) => g.children?.[1]?.getAttribute?.("d")), layerD, "a riding edge is not re-pathed during the drag");
    assert.ok(perFrame.slice(1).every((n) => n <= 300), `crossing edges placed per frame: ${perFrame}`);
    assert.equal(el.style.willChange, "transform", "a moving shell is its own layer for the drag");
    m.stub.dispatch(el, "pointerup", { clientX: p.clientX + 30, clientY: p.clientY + 20, button: 0, buttons: 0, pointerId: 7 });
    assert.equal(riders(root), null, "the drag layer is gone in the drop's task");
    assert.equal(m.commits.length, 1, "one commit (one undo entry) for the whole move");
    assert.equal(el.style.willChange, "");
    const moved = before.filter(([g, d]) => g.children?.[1]?.getAttribute?.("d") !== d).length;
    assert.equal(moved, before.length, "every rider is placed at the committed spot before the frame paints");
    assert.ok(before.every(([g]) => g.parentElement && g.parentElement.getAttribute("class")?.split(" ")[0] === "pxd-edges"), "riders are back in the edges layer");
  } finally { m.done(); }
});

test("E6: dragLayer off keeps the 3.34.0 drag (every touching edge placed each frame, no layer)", async () => {
  const { m, root, el, p } = await dragSelection({ dragLayer: false });
  try {
    m.stub.dispatch(el, "pointerdown", { ...p, button: 0, buttons: 1, pointerId: 7 });
    let most = 0;
    for (let i = 1; i <= 6; i += 1) {
      const p0 = m.view.stats().edgePlacements;
      m.stub.dispatch(el, "pointermove", { clientX: p.clientX + i * 3, clientY: p.clientY + i * 2, buttons: 1, pointerId: 7 });
      m.stub.flushFrames();
      most = Math.max(most, m.view.stats().edgePlacements - p0);
      assert.equal(riders(root), null);
    }
    assert.ok(most > 300, `every touching edge per frame (${most})`);
    m.stub.dispatch(el, "pointerup", { clientX: p.clientX + 18, clientY: p.clientY + 12, button: 0, buttons: 0, pointerId: 7 });
  } finally { m.done(); }
});

// E2-5 (perf2): crumb back to a kept PhD MAIN at fit un-parked ~1,500 attached shells in one task (QA3: 514-595 ms,
// 3.34.0 311). The un-park now renders the nearest RESUME_SHELLS; the rest come back in slices over styled boxes.
const builtAtFit = async (flags = {}) => {
  const m = mountBig({ x: 300, y: 20, zoom: 0.1 }, { fullscreen: true, flags });
  await settledIn(m);
  for (let k = 0; k < 40 && m.view.stats().shells < 1570; k += 1) { await tick(100); await m.pump(50); }
  await tick(700);
  await m.pump(20);
  return m;
};
test("E2-5: crumb back to a fully built big board un-parks with ~96 shells, slices the rest in, and never misses a card", async () => {
  const m = await builtAtFit();
  try {
    assert.ok(m.view.paintAudit().attached > 1400, `built and attached at fit: ${m.view.paintAudit().attached}`);
    const before = m.view.stats().edgePlacements;
    m.view.suspend();
    assert.equal(m.view.park(), true);
    m.view.unpark();
    m.view.resume();
    const first = m.view.paintAudit();
    assert.ok(first.attached <= 120, `attached when the board shows again: ${first.attached}`);
    assert.equal(first.missing, 0, "the rest are boxes");
    const frames = [];
    for (let i = 0; i < 60; i += 1) { m.stub.flushFrames(); await null; frames.push(m.view.paintAudit()); }
    assert.deepEqual(missingFrames(frames), []);
    assert.equal(frames.at(-1).attached, frames.at(-1).inView, "every in-view shell is back");
    assert.equal(m.view.stats().edgePlacements, before, "no edge is re-placed");
  } finally { m.done(); }
});

test("E2-5: slicedResume off un-parks every attached shell at once (3.34.0 + E)", async () => {
  const m = await builtAtFit({ slicedResume: false });
  try {
    const n = m.view.paintAudit().attached;
    m.view.suspend();
    m.view.park();
    m.view.unpark();
    m.view.resume();
    assert.equal(m.view.paintAudit().attached, n);
  } finally { m.done(); }
});

// E2-2 (perf2): QA3 zoom-in fit->detail lost up to 123 of 139 in-view cards for ~0.6 s after the flip. When the settle's
// slices ran out (only built shells count), releaseUnderlay hid the boxes and the cover that should follow returned at
// once (underlayDrawn still set), and at detail it never drew queued cards. Ctrl-wheel into the part of the board the
// open had not built yet, fullscreen, real card render cost.
test("E2-2: a Ctrl-wheel zoom into unbuilt cards keeps a box under every in-view card until its shell is in the DOM", async () => {
  const m = mountBig({ x: 300, y: 20, zoom: 0.1 }, { fullscreen: true, renderMs: 1 });
  try {
    await settledIn(m);
    const frames = [];
    const audit = async () => { await null; await null; frames.push(m.view.paintAudit()); };
    for (let i = 0; i < 9; i += 1) {
      m.stub.dispatch(m.view.root, "wheel", { deltaX: 0, deltaY: -20, ctrlKey: true, deltaMode: 0, clientX: 1100, clientY: 120 });
      await tick(16);
      m.stub.flushFrames();
      await audit();
    }
    for (let i = 0; i < 40; i += 1) { await tick(16); m.stub.flushTimers(); m.stub.flushFrames(); await audit(); m.stub.flushIdle(); }
    assert.equal(m.view.state().lod, "detail");
    assert.deepEqual(missingFrames(frames), []);
    assert.equal(frames.at(-1).attached, frames.at(-1).inView);
  } finally { m.done(); }
});

test("E2-2: the cover released when the slices run out draws the in-view cards that have no shell in the DOM", async () => {
  const m = mountBig({ x: 300, y: 20, zoom: 0.1 });
  try {
    await m.pump(30);
    // Park and come back: the resume keeps 96 shells, the slices end once the built ones are back, the queued rest
    // must stay boxes until the pump builds them.
    m.view.suspend();
    m.view.park();
    m.view.unpark();
    m.view.resume();
    let worst = 0;
    for (let i = 0; i < 80; i += 1) { m.stub.flushFrames(); await null; worst = Math.max(worst, m.view.paintAudit().missing); m.stub.flushIdle(); }
    assert.equal(worst, 0);
  } finally { m.done(); }
});

test("E2-2: the zoom-in settle parks far edges in slices (at most ~500 per task), not ~1,300 in one task", async () => {
  const { sharedTaskProbe } = await import("../src/long-tasks.js");
  const m = await builtAtFit();
  const probe = sharedTaskProbe();
  const orig = probe.span;
  const drops = [];
  try {
    probe.span = (name, fn, phase) => {
      const a = m.view.stats().edgesAttached;
      try { return orig(name, fn, phase); } finally { drops.push([name, a - m.view.stats().edgesAttached]); }
    };
    const frames = await zoomBurst(m, -1, 4);
    assert.equal(m.view.state().lod, "detail");
    assert.deepEqual(missingFrames(frames), []);
    const most = Math.max(...drops.map(([, d]) => d));
    assert.ok(most <= 500, `edges parked or dropped in one task: ${most} (${JSON.stringify(drops.filter(([, d]) => d > 100))})`);
    assert.ok(m.view.stats().edgesAttached < 1500, "the far edges are parked in the end");
  } finally { probe.span = orig; m.done(); }
});

// E2-1 (perf2): overviewCanvas. QA3: while zooming toward the map tier the canvas bitmap was upscaled (blurry flat
// blocks), and at ~0.3 the flat line-colour blocks turned into card-look shells in one frame (the hand-back pop).
const bitmapScale = (canvas) => canvas.width / parseFloat(canvas.style.width || /(?:^|;)width:([\d.]+)px/.exec(canvas.style.cssText)?.[1]);
test("E2-1: on the overview canvas a zoom burst redraws the bitmap before it would be upscaled (no blur)", async () => {
  const m = mountBig({ x: 300, y: 20, zoom: 0.1 }, { flags: { overviewCanvas: true }, fullscreen: true });
  try {
    await settledIn(m);
    const canvas = m.view.root.querySelector(".pxd-underlay");
    const worst = [];
    for (let i = 0; i < 4; i += 1) {
      m.stub.dispatch(m.view.root, "wheel", { deltaX: 0, deltaY: -20, ctrlKey: true, deltaMode: 0, clientX: 700, clientY: 450 });
      await tick(16);
      m.stub.flushFrames();
      const z = m.view.viewport().zoom;
      worst.push(+(z / bitmapScale(canvas)).toFixed(2));
    }
    assert.equal(m.view.state().lod, "overview", "still the canvas tier during the burst");
    assert.ok(worst.every((u) => u <= 1.35), `upscale per frame: ${worst}`);
  } finally { m.done(); }
});

test("E2-1: the hand-back from the overview canvas to the map tier draws the boxes in the map card look with titles", async () => {
  const VARS2 = { "--pxd-card": "#26333f", "--pxd-border-strong": "#6b7f91", "--pxd-red-line": "#f87171", "--pxd-red-fill": "#3a1f1f", "--pxd-red-text": "#fca5a5", "--pxd-text": "#e5e7eb" };
  const titled = (board) => { let i = 0; for (const item of board.items.values()) { if (item.type === "section") continue; item.color = i % 2 ? "red" : ""; item.title = `Card ${i}`; i += 1; } };
  const m = mountBig({ x: 300, y: 20, zoom: 0.1 }, { flags: { overviewCanvas: true }, fullscreen: true, theme: VARS2, prep: titled });
  try {
    await settledIn(m);
    const canvas = m.view.root.querySelector(".pxd-underlay");
    const frames = [];
    let handBack = null;
    for (let i = 0; i < 6; i += 1) {
      m.stub.dispatch(m.view.root, "wheel", { deltaX: 0, deltaY: -20, ctrlKey: true, deltaMode: 0, clientX: 700, clientY: 450 });
      await tick(16);
      m.stub.flushFrames();
      frames.push(m.view.paintAudit());
    }
    for (let i = 0; i < 30 && !handBack; i += 1) {
      await tick(16);
      m.stub.flushTimers();
      if (m.view.state().lod !== "overview" && canvas.style.display !== "none") handBack = canvas.__ctx.ops.map((op) => op.join(" "));
      m.stub.flushFrames();
      frames.push(m.view.paintAudit());
    }
    for (let i = 0; i < 60; i += 1) { await tick(16); m.stub.flushTimers(); m.stub.flushFrames(); m.stub.flushIdle(); frames.push(m.view.paintAudit()); }
    assert.equal(m.view.state().lod, "map");
    assert.ok(handBack, "the canvas is up when the tier flips");
    assert.ok(handBack.includes("fill #26333f"), `card fill, not flat line-colour blocks: ${handBack.slice(0, 6)}`);
    assert.ok(handBack.includes("stroke #f87171") && handBack.includes("stroke #6b7f91"), "card borders");
    assert.ok(handBack.some((op) => op.startsWith("fillText #fca5a5 Card")), "coloured cards' titles in the palette text colour");
    assert.ok(!handBack.includes("fillRect #f87171"), "no overview line-colour block");
    assert.deepEqual(missingFrames(frames), []);
  } finally { m.done(); }
});

// E2-4 (perf2): QA3 C zoom-out: the burst boxes were dark detail cards with a faint border on a dark board, a
// near-blank frame (#9) and sparse dim boxes. Below a readable size their title and body are text-coloured bars.
test("E2-4: a zoom-out burst from detail draws the far cards with greeked titles and body lines, not empty dark boxes", async () => {
  const VARS3 = { "--pxd-card": "#26333f", "--pxd-border-strong": "#6b7f91", "--pxd-text": "#e5e7eb" };
  const titled = (board) => { let i = 0; for (const item of board.items.values()) { if (item.type === "section") continue; item.title = `Card number ${i}`; i += 1; } };
  const m = mountBig({ x: -2000, y: -1500, zoom: 1 }, { theme: VARS3, prep: titled });
  try {
    await settledIn(m);
    for (let i = 0; i < 6; i += 1) {
      m.stub.dispatch(m.view.root, "wheel", { deltaX: 0, deltaY: 20, ctrlKey: true, deltaMode: 0, clientX: 700, clientY: 450 });
      await tick(16);
      m.stub.flushFrames();
    }
    assert.ok(m.view.viewport().zoom < 0.5);
    const canvas = m.view.root.querySelector(".pxd-underlay");
    assert.ok(canvas && canvas.style.display !== "none");
    const ops = canvas.__ctx.ops.map((op) => op.join(" "));
    const bars = ops.filter((op) => op === "fillRect #e5e7eb").length;
    assert.ok(bars > 100, `greeked text bars on the burst boxes: ${bars}`);
    assert.ok(ops.includes("fill #26333f"), "the boxes keep the card fill");
  } finally { m.done(); }
});
