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
import { noteSpeedFlags } from "../src/settings.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { gestureIdle } from "../src/view/query-card.js";
import { continueAfterBlob } from "../src/view/blob-yield.js";

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

test("PXD-31: a cold search scans on the key only when gestureJobs is off", () => {
  const type = (m, value) => {
    const input = m.view.root.querySelector(".pxd-search__input");
    assert.ok(input, "search input");
    input.value = value;
    m.stub.dispatch(input, "input");
  };
  const off = mountBig({ x: 0, y: 0, zoom: 1 }, { flags: { gestureJobs: false } });
  try {
    for (const value of ["a", "ab", "abc", "abcd"]) type(off, value);
    const stats = off.view.searchStats();
    assert.equal(stats.keys, 4);
    assert.equal(stats.scans, stats.keys);
  } finally {
    off.done();
  }
  const on = mountBig({ x: 0, y: 0, zoom: 1 });
  try {
    for (const value of ["a", "ab", "abc", "abcd"]) type(on, value);
    const stats = on.view.searchStats();
    assert.equal(stats.scans, 0);
    assert.equal(stats.keys, 4);
  } finally {
    on.done();
  }
});

test("PXD-31: gestureIdle skips a spent deadline only when the flag is on", () => {
  let queued = null;
  const win = { requestIdleCallback(fn) { queued = fn; return 1; } };
  noteSpeedFlags({ gestureJobs: false });
  try {
    let ran = false;
    gestureIdle(() => { ran = true; }, win);
    queued({ timeRemaining: () => 0, didTimeout: false });
    assert.equal(ran, true);
    noteSpeedFlags({ gestureJobs: true });
    ran = false;
    gestureIdle(() => { ran = true; }, win);
    queued({ timeRemaining: () => 0, didTimeout: false });
    assert.equal(ran, false);
    queued();
    assert.equal(ran, true);
  } finally {
    noteSpeedFlags(null);
  }
});

test("PXD-31: continueAfterBlob yields while a hold is up and runs at once when the flag is off", () => {
  noteSpeedFlags({ gestureJobs: false });
  try {
    let ran = false;
    continueAfterBlob(() => { ran = true; });
    assert.equal(ran, true);
    noteSpeedFlags({ gestureJobs: true });
    ran = false;
    const delays = [];
    continueAfterBlob(() => { ran = true; }, {
      setTimer(fn, ms) { delays.push(ms); },
      held: () => false,
    });
    assert.equal(ran, false);
    assert.deepEqual(delays, [0]);
    ran = false;
    let t = 0;
    const armed = [];
    continueAfterBlob(() => { ran = true; }, {
      setTimer(fn, ms) { armed.push({ fn, ms }); },
      held: () => true,
      now: () => t,
    });
    assert.equal(armed[0].ms, 0);
    armed[0].fn();
    assert.equal(ran, false);
    assert.equal(armed[1].ms, 32);
    t = 1999;
    armed[1].fn();
    assert.equal(ran, false);
    assert.equal(armed.at(-1).ms, 32);
    t = 2000;
    armed.at(-1).fn();
    assert.equal(ran, true);
  } finally {
    noteSpeedFlags(null);
  }
});

function cardsUnderCamera(m) {
  const v = m.view.viewport();
  const out = [];
  for (const el of m.view.root.querySelectorAll(".pxd-item--card")) {
    const uid = el.getAttribute("data-uid");
    const r = m.session.rects.get(uid);
    if (!r) continue;
    const cx = v.x + (r.x + r.w / 2) * v.zoom;
    const cy = v.y + (r.y + r.h / 2) * v.zoom;
    if (cx >= 0 && cy >= 0 && cx <= 1400 && cy <= 900) out.push({ el, uid, cx, cy });
  }
  return out;
}

test("PXD-31: a big-board sweep hovers by attribute and does not remeasure", () => {
  const m = mountBig({ x: 0, y: 0, zoom: 1 }, { flags: { gestureJobs: true } });
  try {
    m.mountEl.className = "pxd-mount";
    for (let i = 0; i < 40; i += 1) m.stub.flushFrames();
    const cards = cardsUnderCamera(m);
    assert.ok(cards.length >= 2, `cards in the stub: ${cards.length}`);
    const root = m.view.root;
    let rects = 0;
    const orig = root.getBoundingClientRect;
    root.getBoundingClientRect = () => { rects += 1; return orig(); };
    const move = (card) => m.stub.dispatch(root, "pointermove", { clientX: card.cx, clientY: card.cy, buttons: 0 });
    move(cards[0]);
    const afterFirst = rects;
    move(cards[1]);
    move(cards[0]);
    move(cards[1]);
    assert.equal(rects, afterFirst, "later moves read the root rect");
    const hovered = [...root.querySelectorAll("[data-pxd-hover]")];
    assert.equal(hovered.length, 1);
    assert.equal(hovered[0].getAttribute("data-uid"), cards[1].uid);
    assert.equal(root.querySelectorAll(".pxd-item--drop").length, 0);
    assert.ok(m.stub.document.querySelector(".pxd-hit-shield"));
  } finally {
    m.done();
  }
  const off = mountBig({ x: 0, y: 0, zoom: 1 }, { flags: { gestureJobs: false } });
  try {
    for (let i = 0; i < 40; i += 1) off.stub.flushFrames();
    const cards = cardsUnderCamera(off);
    assert.ok(cards.length >= 2, `cards in the stub: ${cards.length}`);
    const move = (card) => off.stub.dispatch(card.el, "pointermove", { clientX: card.cx, clientY: card.cy, buttons: 0 });
    move(cards[0]);
    move(cards[1]);
    assert.equal(cards[1].el.classList.contains("pxd-item--drop"), false);
    assert.equal(cards[1].el.hasAttribute("data-pxd-hover"), false);
  } finally {
    off.done();
  }
});

test("PXD-31: twelve cards do not raise the hit shield", () => {
  noteSpeedFlags({ gestureJobs: true });
  const stub = createDomStub({ width: 1400, height: 900 });
  const restore = stub.install();
  const blk = (uid, string, plexus, order) => ({
    ":block/uid": uid,
    ":block/string": string,
    ":block/order": order,
    ":block/props": plexus ? { ":plexus": plexus } : {},
    ":block/children": [],
  });
  const children = [];
  for (let i = 0; i < 12; i += 1) {
    children.push(blk(`c${String(i).padStart(7, "0")}`, `Card ${i}`, { ":x": 40 + (i % 4) * 220, ":y": 40 + Math.floor(i / 4) * 180, ":w": 160, ":h": 100 }, i));
  }
  const raw = {
    ":block/uid": "board0001",
    ":block/string": "{{[[diagram]]:Test}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": children,
  };
  const board = buildBoard(raw);
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
  mountEl.className = "pxd-mount";
  stub.document.body.append(mountEl);
  stub.localStorage.setItem("plexus-diagram:vp:Svy:board0001", JSON.stringify({ x: 0, y: 0, zoom: 1 }));
  const view = mountBoardView({ host, session, mountEl, settings: { get: () => undefined }, version: "1.0.0" });
  try {
    for (let i = 0; i < 8; i += 1) stub.flushFrames();
    const el = view.root.querySelector(".pxd-item--card");
    assert.ok(el);
    const uid = el.getAttribute("data-uid");
    const r = session.rects.get(uid);
    const v = view.viewport();
    stub.dispatch(view.root, "pointermove", {
      clientX: v.x + (r.x + r.w / 2) * v.zoom,
      clientY: v.y + (r.y + r.h / 2) * v.zoom,
      buttons: 0,
    });
    assert.equal(stub.document.querySelector(".pxd-hit-shield"), null);
    assert.equal(el.classList.contains("pxd-item--drop"), false);
  } finally {
    view.dispose();
    restore();
    noteSpeedFlags(null);
  }
});

test("PXD-34: a layout publish skips buildBoard, and a new block does not", { timeout: 120000 }, async () => {
  const open = () => {
    const fake = createFakeRoam({ echoDelay: 0 });
    const seed = toSeed(bigBoardTree());
    seed.children.push({ uid: "brefcard", string: "((outsideref))", props: { plexus: { type: "card", x: 9000, y: 9000, w: 200, h: 80, v: 2 } }, children: [] });
    fake.seedBoard({ uid: seed.uid, string: seed.string, props: seed.props, children: seed.children });
    const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
    let lookups = 0;
    const read = host.blockString.bind(host);
    host.blockString = (id) => { lookups += 1; return read(id); };
    const session = acquireSession(seed.uid, { host, linkDelay: 0 });
    lookups = 0;
    return { session, count: () => lookups, reset() { lookups = 0; } };
  };
  let offN = 0;
  let onN = 0;
  let createN = 0;
  let sectionN = 0;
  let addHits = -1;
  let moveHits = 0;
  try {
    noteSpeedFlags({ layoutPatch: false });
    const off = open();
    try {
      await off.session.commitMove(["bc00000"], 30, 10);
      offN = off.count();
      assert.ok(offN >= 2, `off lookups ${offN}`);
      const moved = off.session.board.items.get("bc00000");
      assert.ok(Math.abs(moved.x - 54) < 0.2, `x ${moved.x}`);
      assert.equal(moved.parentUid, "bs0");
      assert.equal(off.session.layoutPatchHits(), 0);
    } finally {
      off.session.release?.();
      resetSessions();
    }
    noteSpeedFlags({ layoutPatch: true });
    const on = open();
    try {
      await on.session.commitMove(["bc00000"], 30, 10);
      onN = on.count();
      assert.equal(onN, 0);
      const moved = on.session.board.items.get("bc00000");
      assert.ok(Math.abs(moved.x - 54) < 0.2, `x ${moved.x}`);
      assert.equal(moved.title, "Card 1");
      moveHits = on.session.layoutPatchHits();
      assert.ok(moveHits > 0, `move hits ${moveHits}`);
      on.reset();
      const hitsAtCreate = on.session.layoutPatchHits();
      const made = await on.session.createCard({ x: 20000, y: 20000, string: "New" });
      createN = on.count();
      assert.ok(createN > 0, `create lookups ${createN}`);
      assert.equal(on.session.layoutPatchHits(), hitsAtCreate);
      assert.equal(on.session.board.items.get(made)?.string, "New");
      on.reset();
      const section = await on.session.createSection({ rect: { x: 20000, y: 20000, w: 400, h: 300 }, title: "Far" });
      sectionN = on.count();
      assert.ok(sectionN > 0, `section lookups ${sectionN}`);
      assert.equal(on.session.board.items.get(section)?.title, "Far");
      assert.equal(on.session.layoutPatchHits(), hitsAtCreate);
    } finally {
      on.session.release?.();
      resetSessions();
    }
    noteSpeedFlags({ layoutPatch: true });
    const add = open();
    try {
      const made = await add.session.createCard({ x: 20000, y: 20000, string: "PXD-BENCH add" });
      await add.session.setString(made, "PXD-BENCH add");
      await add.session.growToFit(made, 500);
      addHits = add.session.layoutPatchHits();
      assert.equal(addHits, 0, `add entered layoutPatch ${addHits}`);
      const card = add.session.board.items.get(made);
      assert.equal(card?.string, "PXD-BENCH add");
      assert.ok(card.h >= 500);
    } finally {
      add.session.release?.();
      resetSessions();
    }
  } finally {
    console.log(`PXD-34 lookups off=${offN} on=${onN} create=${createN} section=${sectionN} addHits=${addHits} moveHits=${moveHits}`);
    noteSpeedFlags(null);
    resetSessions();
  }
});

test.after(() => { if (process.env.PXD_PRINT_BUDGETS) console.log(JSON.stringify(counts)); });
