import assert from "node:assert/strict";
import test from "node:test";
import { bigBoardTree } from "../src/model/stress-board.js";
import { buildBoard, worldRects } from "../src/model/board.js";
import { mountBoardView } from "../src/view/board-view.js";
import { noteSpeedFlags } from "../src/settings.js";
import { createDomStub } from "./fixtures/dom-stub.js";

// perf2 lane E: no-flash navigation and tier flips on the 1,560-card fixture, through the view's real entry points.
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

export function mountBig(vp, { flags = {}, fullscreen = false, theme = null, prep = null } = {}) {
  noteSpeedFlags(flags);
  const stub = createDomStub({ width: 1400, height: 900 });
  const restore = stub.install();
  if (theme) Object.assign(stub.theme, theme);
  stub.localStorage.setItem("plexus-diagram:vp:Svy:bigroot", JSON.stringify(vp));
  const board = buildBoard(bigBoardTree());
  prep?.(board);
  const host = {
    stats: {}, graph: "Svy",
    renderString(el, string) { el.textContent = string; },
    renderBlock(el, uid) { el.textContent = uid; },
    unmount() {},
    pagePreview: () => ({ exists: false, blocks: [] }), pullTree: () => [], blockString: () => null,
    openBlock() {}, openInSidebar() {}, searchPages: () => [], searchBlocks: () => [], related: () => [],
  };
  const subs = new Map();
  const commits = [];
  const session = {
    uid: board.uid, board, rects: worldRects(board), links: [], coveredEdges: new Set(), release() {}, setLinkMode() {},
    on(name, fn) { if (!subs.has(name)) subs.set(name, new Set()); subs.get(name).add(fn); return () => subs.get(name)?.delete(fn); },
    // The session's optimistic move (session.js commitMove): new rects for the moved items and their members, one change.
    commitMove(uids, dx, dy) {
      commits.push({ uids: [...uids], dx, dy });
      const moved = new Set(uids);
      for (const item of board.items.values()) { let p = item.parentUid; while (p && !moved.has(item.uid)) { if (moved.has(p)) moved.add(item.uid); p = board.items.get(p)?.parentUid; } }
      const next = new Map(session.rects);
      for (const uid of moved) { const r = next.get(uid); if (r) next.set(uid, { ...r, x: r.x + dx, y: r.y + dy }); }
      session.rects = next;
      for (const fn of subs.get("change") || []) fn({ dirty: moved });
      return Promise.resolve();
    },
  };
  const mountEl = stub.document.createElement("div");
  stub.document.body.append(mountEl);
  const view = mountBoardView({ host, session, mountEl, settings: { get: () => undefined }, version: "1.0.0", fullscreen });
  const pump = async (n) => {
    for (let i = 0; i < n; i += 1) { stub.flushFrames(); stub.flushIdle(); stub.flushTimers(); }
    await tick(0);
    for (let i = 0; i < 4; i += 1) { stub.flushFrames(); stub.flushIdle(); stub.flushTimers(); }
  };
  const settle = async () => { await tick(160); await pump(4); };
  const done = () => { try { view.dispose(); } catch { /* gone */ } restore(); noteSpeedFlags(null); };
  return { stub, view, mountEl, pump, settle, done, board, session, commits };
}

export const withFrozenClock = async (fn) => {
  const realNow = globalThis.performance.now;
  globalThis.performance.now = () => 1_000_000;
  try { await fn(); } finally { globalThis.performance.now = realNow; }
};

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

// A Ctrl-wheel zoom burst on the fixture, then every frame until the settle's slices are done. Real clock: the wheel
// zoom gesture ends on a real 160 ms timer (interactions.js) and the settle is a real 120 ms timer.
async function zoomBurst(m, dir, ticks) {
  const frames = [];
  const audit = async () => { await null; await null; frames.push(m.view.paintAudit()); };
  await audit();
  for (let i = 0; i < ticks; i += 1) {
    m.stub.dispatch(m.view.root, "wheel", { deltaX: 0, deltaY: 60 * dir, ctrlKey: true, deltaMode: 0, clientX: 700, clientY: 450 });
    m.stub.flushFrames();
    await audit();
  }
  for (let i = 0; i < 30; i += 1) { await tick(30); m.stub.flushTimers(); m.stub.flushFrames(); await audit(); m.stub.flushIdle(); }
  for (let i = 0; i < 80; i += 1) { m.stub.flushFrames(); await audit(); m.stub.flushIdle(); m.stub.flushTimers(); }
  return frames;
}
const settledIn = async (m) => { await m.pump(300); await m.settle(); await tick(200); await m.pump(100); };
const missingFrames = (frames) => frames.filter((f) => f.missing > 0).map((f) => `${f.lod}:${f.attached}+${f.covered}/${f.inView}`);

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
async function dragSelection(flags) {
  const m = mountBig({ x: 300, y: 20, zoom: 0.1 }, { flags });
  await m.pump(400);
  await tick(300);
  await m.pump(100);
  const root = m.view.root;
  // Shift-marquee from empty space over the top-left of the board.
  m.stub.dispatch(root, "pointerdown", { clientX: 5, clientY: 5, button: 0, buttons: 1, shiftKey: true, pointerId: 5 });
  m.stub.dispatch(root, "pointermove", { clientX: 700, clientY: 300, buttons: 1, shiftKey: true, pointerId: 5 });
  m.stub.dispatch(root, "pointerup", { clientX: 700, clientY: 300, button: 0, buttons: 0, shiftKey: true, pointerId: 5 });
  m.stub.flushFrames();
  const sel = m.view.state().selection;
  const els = new Map([...root.querySelectorAll(".pxd-item")].map((el) => [el.getAttribute("data-uid"), el]));
  const pick = sel.find((u) => m.board.items.get(u)?.type === "card" && els.has(u));
  const r = m.session.rects.get(pick);
  const v = m.view.viewport();
  const p = { clientX: v.x + (r.x + r.w / 2) * v.zoom, clientY: v.y + (r.y + r.h / 2) * v.zoom };
  return { m, root, sel, el: els.get(pick), p };
}
const riders = (root) => root.querySelector(".pxd-edges--drag");

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
