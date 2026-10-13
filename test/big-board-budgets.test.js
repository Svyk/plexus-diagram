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

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
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
