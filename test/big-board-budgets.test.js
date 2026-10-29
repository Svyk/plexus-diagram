// Big-board CI bench (Fable round, 2026-10-12): a board shaped like the PhD main board, no Roam. Every number is a
// ceiling in tools/live/big-board-budgets.json that may only go down (lowerBigCeilings refuses a raise).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { mock } from "node:test";
import { bigBoardTree, treeBlockCount } from "../src/model/stress-board.js";
import { buildBoard, worldRects } from "../src/model/board.js";
import { mountBoardView } from "../src/view/board-view.js";
import { SPLIT_HOLD_MS, createHost } from "../src/host/roam.js";
import { SPLIT_WATCH_MIN } from "../src/host/split-watch.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { BIG_BUDGETS_PATH, checkBigCeilings, lowerBigCeilings, readBigBudgets } from "../tools/live/big-board-budgets.mjs";
import { dragSelection, mountBig, settledIn, zoomBurst, tick } from "./fixtures/big-mount.js";

const counts = {};

// Pull trees carry :plexus props with colon keys; the fake Roam seeds plain ones.
const toSeed = (n) => ({ uid: n[":block/uid"], string: n[":block/string"], props: n[":block/props"] ? { plexus: n[":block/props"].plexus } : undefined, heading: n[":block/heading"], open: n[":block/open"], children: (n[":block/children"] || []).map(toSeed) });

test("the fixture is the PhD main board's shape", () => {
  const tree = bigBoardTree();
  const board = buildBoard(tree);
  const cards = [...board.items.values()].filter((it) => it.type !== "section").length;
  assert.equal(cards, 1524, "1,500 cards plus 24 nested boards");
  assert.equal([...board.items.values()].filter((it) => it.type === "section").length, 46);
  assert.ok(board.edges.size >= 2000, `edges: ${board.edges.size}`);
  const blocks = treeBlockCount(tree);
  assert.ok(blocks >= 20000 && blocks <= 25000, `blocks: ${blocks}`);
  assert.ok(blocks >= SPLIT_WATCH_MIN);
});

test("one write re-pulls a bounded part of the board under the split watch", async () => {
  const fake = createFakeRoam({ echoDelay: 1 });
  fake.roamWatch = true;
  const seed = toSeed(bigBoardTree());
  fake.seedBoard({ uid: seed.uid, string: seed.string, props: seed.props, children: seed.children });
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  const full = host.pullBoard("bigroot");
  const total = treeBlockCount(full);
  const trees = [];
  const off = host.watchBoard("bigroot", (t) => trees.push(t));
  counts.watchesPerBoard = host.stats.watches + (host.splitStats("bigroot")?.containers || 0);
  fake.pullCounter = { n: 0 };
  await fake.api.data.block.update({ block: { uid: "bc00100", string: "edited" } });
  await fake.flush();
  assert.equal(trees.length, 1);
  counts.blocksPerWatchFire = fake.pullCounter.n;
  assert.ok(counts.blocksPerWatchFire < total / 4, `one write re-pulled ${counts.blocksPerWatchFire} of ${total} blocks`);
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    off();
    assert.equal(host.stats.watches, 0, "no subscriber is left (the split is held until SPLIT_HOLD_MS)");
    mock.timers.tick(SPLIT_HOLD_MS);
    assert.equal(host.splitStats("bigroot"), null);
    assert.equal(fake.watchCount(), 0, "every Roam watch is removed once the hold ends");
  } finally {
    mock.timers.reset();
  }
});

function mount(vp) {
  const stub = createDomStub({ width: 1400, height: 900 });
  const restore = stub.install();
  stub.localStorage.setItem("plexus-diagram:vp:Svy:bigroot", JSON.stringify(vp));
  const board = buildBoard(bigBoardTree());
  const host = {
    stats: {}, graph: "Svy",
    renderString(el, string) { el.textContent = string; },
    renderBlock(el, uid) { el.textContent = uid; },
    unmount() {},
    pagePreview: () => ({ exists: false, blocks: [] }), pullTree: () => [], blockString: () => null,
    openBlock() {}, openInSidebar() {}, searchPages: () => [], searchBlocks: () => [], related: () => [],
  };
  const session = { uid: board.uid, board, rects: worldRects(board), links: [], coveredEdges: new Set(), on() { return () => {}; }, release() {}, setLinkMode() {} };
  const mountEl = stub.document.createElement("div");
  stub.document.body.append(mountEl);
  const view = mountBoardView({ host, session, mountEl, settings: { get: () => undefined }, version: "1.0.0" });
  const pump = async (n) => { for (let i = 0; i < n; i += 1) { stub.flushFrames(); stub.flushIdle(); await tick(0); } };
  const nodes = () => { let n = 0; const walk = (el) => { n += 1; for (const c of el.children || []) walk(c); }; walk(view.root); return n; };
  return { stub, restore, view, pump, nodes, shells: () => view.root.querySelectorAll(".pxd-item[data-uid]").length, edges: () => view.root.querySelectorAll(".pxd-edge").length };
}

test("the DOM near the view stays bounded at detail and at map zoom, and dispose leaves nothing", async () => {
  const detail = mount({ x: -2000, y: -2000, zoom: 1 });
  try {
    await detail.pump(120);
    counts.attachedShellsAtDetail = detail.shells();
    counts.attachedEdgesAtDetail = detail.edges();
    counts.domNodesAtDetail = detail.nodes();
    const stats = detail.view.stats();
    counts.listenersPerBigBoard = stats.listeners;
  } finally {
    detail.view.dispose();
    detail.restore();
  }
  const map = mount({ x: 0, y: 0, zoom: 0.25 });
  try {
    await map.pump(120);
    counts.attachedShellsAtMap = map.shells();
    counts.attachedEdgesAtMap = map.edges();
    counts.domNodesAtMap = map.nodes();
    map.view.dispose();
    assert.equal(map.view.root.parentElement, null, "the root left the document");
  } finally {
    map.restore();
  }
  assert.ok(counts.attachedShellsAtDetail < 200, `shells at detail: ${counts.attachedShellsAtDetail}`);
  assert.ok(counts.attachedShellsAtMap < 1524, `shells at map: ${counts.attachedShellsAtMap}`);
});

// perf2 lane E: no-flash counts. A swap frame is a frame where an in-view card is neither an attached shell nor a
// box on the underlay. Edge churn per nav: edges re-placed plus edge elements replaced when a parked board resumes.
test("no-flash counts: swap frames, edge churn on a crumb back, shells restyled by a tier flip, edges placed per drag frame", async () => {
  let swap = 0;
  for (const [vp, dir, ticks] of [[{ x: -2000, y: -1500, zoom: 1 }, 1, 14], [{ x: 300, y: 20, zoom: 0.1 }, -1, 16]]) {
    const m = mountBig(vp, { virtualClock: true });
    try {
      await settledIn(m);
      const frames = await zoomBurst(m, dir, ticks);
      swap += frames.filter((f) => f.missing > 0).length;
      if (dir < 0) counts.shellsAtZoomInFlip = m.view.flipStats().attachedAtFlip.at(-1) ?? 9999;
    } finally { m.done(); }
  }
  {
    const m = mountBig({ x: 300, y: 20, zoom: 0.1 }, { virtualClock: true });
    try {
      await m.pump(30);
      const placed = m.view.stats().edgePlacements;
      const els = new Set(m.view.root.querySelectorAll(".pxd-edge"));
      m.view.suspend();
      m.view.park();
      m.view.unpark();
      m.view.resume();
      for (let i = 0; i < 6; i += 1) {
        m.stub.flushFrames();
        await tick(0);
        if (m.view.paintAudit().missing > 0) swap += 1;
      }
      const after = new Set(m.view.root.querySelectorAll(".pxd-edge"));
      counts.edgeChurnPerCrumbBack = (m.view.stats().edgePlacements - placed) + [...els].filter((el) => !after.has(el)).length;
    } finally { m.done(); }
  }
  counts.swapFramesMissingCards = swap;
  {
    const { m, el, p } = await dragSelection({});
    try {
      m.stub.dispatch(el, "pointerdown", { ...p, button: 0, buttons: 1, pointerId: 7 });
      let most = 0;
      for (let i = 1; i <= 8; i += 1) {
        const p0 = m.view.stats().edgePlacements;
        m.stub.dispatch(el, "pointermove", { clientX: p.clientX + i * 3, clientY: p.clientY + i * 2, buttons: 1, pointerId: 7 });
        m.stub.flushFrames();
        most = Math.max(most, m.view.stats().edgePlacements - p0);
      }
      m.stub.dispatch(el, "pointerup", { clientX: p.clientX + 24, clientY: p.clientY + 16, button: 0, buttons: 0, pointerId: 7 });
      counts.edgesPlacedPerDragFrame = most;
    } finally { m.done(); }
  }
});

// perf2 E2: the live gaps the first fixture missed. A Ctrl-wheel zoom into cards the open had not built yet (fullscreen,
// real render cost) and the overview-canvas hand-back count as swap frames too; a crumb back to a fully built board
// shows at most RESUME_SHELLS shells at once; a grouped drag writes no shell transform per frame.
test("no-flash counts, round 2: zoom into unbuilt cards, canvas hand-back, sliced crumb back, grouped drag", async () => {
  let swap = 0;
  for (const [flags, x, y, ticks] of [[{}, 1100, 120, 9], [{ overviewCanvas: true }, 700, 450, 6]]) {
    const m = mountBig({ x: 300, y: 20, zoom: 0.1 }, { fullscreen: true, renderMs: 1, flags, virtualClock: true });
    try {
      await settledIn(m);
      const audit = async () => { await null; await null; if (m.view.paintAudit().missing > 0) swap += 1; };
      for (let i = 0; i < ticks; i += 1) {
        m.stub.dispatch(m.view.root, "wheel", { deltaX: 0, deltaY: -20, ctrlKey: true, deltaMode: 0, clientX: x, clientY: y });
        await tick(16);
        m.stub.flushFrames();
        await audit();
      }
      for (let i = 0; i < 40; i += 1) { await tick(16); m.stub.flushTimers(); m.stub.flushFrames(); await audit(); m.stub.flushIdle(); }
    } finally { m.done(); }
  }
  counts.swapFramesMissingCards += swap;
  {
    const m = mountBig({ x: 300, y: 20, zoom: 0.1 }, { fullscreen: true, virtualClock: true });
    try {
      await settledIn(m);
      for (let k = 0; k < 40 && m.view.stats().shells < 1570; k += 1) { await tick(100); await m.pump(50); }
      m.view.suspend();
      m.view.park();
      m.view.unpark();
      m.view.resume();
      counts.shellsAttachedAtResume = m.view.paintAudit().attached;
    } finally { m.done(); }
  }
  {
    const { m, root, el, p } = await dragSelection({});
    try {
      m.stub.dispatch(el, "pointerdown", { ...p, button: 0, buttons: 1, pointerId: 7 });
      m.stub.dispatch(el, "pointermove", { clientX: p.clientX + 3, clientY: p.clientY + 2, buttons: 1, pointerId: 7 });
      m.stub.flushFrames();
      let most = 0;
      for (let i = 2; i <= 8; i += 1) {
        const before = new Map([...root.querySelectorAll(".pxd-item")].map((node) => [node, node.style.transform]));
        m.stub.dispatch(el, "pointermove", { clientX: p.clientX + i * 3, clientY: p.clientY + i * 2, buttons: 1, pointerId: 7 });
        m.stub.flushFrames();
        most = Math.max(most, [...before].filter(([node, t]) => node.style.transform !== t).length);
      }
      m.stub.dispatch(el, "pointerup", { clientX: p.clientX + 24, clientY: p.clientY + 16, button: 0, buttons: 0, pointerId: 7 });
      counts.shellTransformsPerDragFrame = most;
    } finally { m.done(); }
  }
});

test("every count is at or under its checked-in ceiling", () => {
  const budgets = readBigBudgets();
  for (const key of Object.keys(counts)) assert.equal(typeof budgets[key], "number", `ceiling for ${key}`);
  try {
    checkBigCeilings(counts, budgets);
  } catch (error) {
    assert.fail(`${error.message}\nmeasured: ${JSON.stringify(counts)}`);
  }
});

test("a ceiling may only go down", () => {
  const dir = mkdtempSync(join(tmpdir(), "big-board-"));
  const file = join(dir, "big-board-budgets.json");
  try {
    copyFileSync(BIG_BUDGETS_PATH, file);
    const before = readBigBudgets(file);
    const key = Object.keys(before)[0];
    assert.throws(() => lowerBigCeilings({ [key]: before[key] + 1 }, file), /only go down/);
    assert.deepEqual(readBigBudgets(file), before);
    const lower = lowerBigCeilings({ [key]: before[key] - 1 }, file);
    assert.equal(lower.changed, true);
    assert.equal(readBigBudgets(file)[key], before[key] - 1);
    assert.throws(() => checkBigCeilings({ [key]: before[key] }, readBigBudgets(file)), /over ceiling/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.after(() => { if (process.env.PXD_PRINT_BUDGETS) console.log(JSON.stringify(counts)); });
