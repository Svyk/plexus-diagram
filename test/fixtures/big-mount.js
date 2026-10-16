// perf2 lane E: the 1,560-card fixture mounted through the real view, and the gestures the no-flash tests drive.
import { bigBoardTree } from "../../src/model/stress-board.js";
import { buildBoard, worldRects } from "../../src/model/board.js";
import { mountBoardView } from "../../src/view/board-view.js";
import { noteSpeedFlags } from "../../src/settings.js";
import { createDomStub } from "./dom-stub.js";

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

// A Ctrl-wheel zoom burst on the fixture, then every frame until the settle's slices are done. Real clock: the wheel
// zoom gesture ends on a real 160 ms timer (interactions.js) and the settle is a real 120 ms timer.
export async function zoomBurst(m, dir, ticks) {
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
export const settledIn = async (m) => { await m.pump(300); await m.settle(); await tick(200); await m.pump(100); };
export const missingFrames = (frames) => frames.filter((f) => f.missing > 0).map((f) => `${f.lod}:${f.attached}+${f.covered}/${f.inView}`);

export async function dragSelection(flags) {
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
export const riders = (root) => root.querySelector(".pxd-edges--drag");
