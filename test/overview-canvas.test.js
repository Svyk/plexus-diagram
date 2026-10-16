import assert from "node:assert/strict";
import test from "node:test";
import { bigBoardTree } from "../src/model/stress-board.js";
import { buildBoard, worldRects } from "../src/model/board.js";
import { mountBoardView } from "../src/view/board-view.js";
import { noteSpeedFlags } from "../src/settings.js";
import { createDomStub } from "./fixtures/dom-stub.js";

// C2 (perf2): below zoom 0.2 the PhD main board built ~1,558 card shells that the overview CSS then hid (headers
// display:none, a coloured box of ~15x10 screen px). With overviewCanvas on, that tier is the underlay canvas: no card
// shell is built or attached, a pan never redraws it, and presses resolve through the model.
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const OVERVIEW = { x: 300, y: 20, zoom: 0.075 };
// bc00000 is at world (64, 88), 200 x 120.
const at = (vp, wx, wy) => ({ clientX: vp.x + wx * vp.zoom, clientY: vp.y + wy * vp.zoom });
const rowFor = (root, id) => [...root.querySelectorAll(".pxd-menu__item")].find((node) => node.getAttribute("data-id") === id);

function mount(vp, flags = { overviewCanvas: true }) {
  noteSpeedFlags(flags);
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
  // E2-1: board cards stay real shells on the canvas tier (they open their board on a click); count the rest.
  const cards = () => view.root.querySelectorAll(".pxd-item--card[data-uid]").filter((el) => !el.classList.contains("pxd-item--board")).length;
  const boardCards = () => view.root.querySelectorAll(".pxd-item--board[data-uid]").length;
  const shells = () => view.stats().shells;
  const underlay = () => view.root.querySelector(".pxd-underlay");
  const shown = () => Boolean(underlay() && underlay().style.display !== "none");
  const draws = () => view.overviewCanvasStats().draws;
  const cam = () => view.root.querySelector(".pxd-world")?.style.transform || "";
  // Frozen clock: chunks end on their count. Frames, idle work and stub timers run; real timers get a turn.
  const pump = async (n) => {
    for (let i = 0; i < n; i += 1) { stub.flushFrames(); stub.flushIdle(); stub.flushTimers(); }
    await tick(0);
    for (let i = 0; i < 4; i += 1) { stub.flushFrames(); stub.flushIdle(); stub.flushTimers(); }
  };
  const settle = async () => { await tick(160); await pump(4); };
  const done = () => { view.dispose(); restore(); noteSpeedFlags(null); };
  return { stub, view, cards, boardCards, shells, shown, draws, cam, pump, settle, done, board };
}

const withFrozenClock = async (fn) => {
  const realNow = globalThis.performance.now;
  globalThis.performance.now = () => 1_000_000;
  try { await fn(); } finally { globalThis.performance.now = realNow; }
};

test("an overview open with overviewCanvas builds no card shell and draws the cards on the canvas", async () => {
  await withFrozenClock(async () => {
    const m = mount(OVERVIEW);
    try {
      await m.pump(60);
      await m.settle();
      assert.equal(m.view.state().lod, "overview");
      assert.equal(m.view.overviewCanvasStats().on, true);
      assert.equal(m.cards(), 0, "no card shell in the DOM");
      const boards = [...m.board.items.values()].filter((item) => item.kind === "board").length;
      assert.equal(m.boardCards(), boards, "every board card is a real shell (a click enters it)");
      assert.ok(m.shells() <= 46 + boards, `only the 46 sections and the board cards are built (${m.shells()})`);
      assert.ok(m.shown(), "the canvas shows the cards");
      assert.ok(m.draws() >= 1 && m.draws() <= 4, `drawn once or a few times at open (${m.draws()})`);
      assert.equal(m.view.root.querySelectorAll(".pxd-edge").length, 0, "edges are hairlines on the canvas");
    } finally { m.done(); }
  });
});

test("overviewCanvas off keeps the 3.34.0 overview: card shells are built", async () => {
  await withFrozenClock(async () => {
    const m = mount(OVERVIEW, {});
    try {
      await m.pump(200);
      assert.equal(m.view.overviewCanvasStats().on, false);
      assert.ok(m.shells() > 1000, `shells built: ${m.shells()}`);
      assert.equal(m.draws(), 0);
    } finally { m.done(); }
  });
});

test("a pan at overview writes no shell and does not redraw the canvas", async () => {
  await withFrozenClock(async () => {
    const m = mount(OVERVIEW);
    try {
      await m.pump(60);
      await m.settle();
      const shells = m.shells();
      const draws = m.draws();
      const cam0 = m.cam();
      for (let i = 0; i < 6; i += 1) {
        m.stub.dispatch(m.view.root, "wheel", { deltaX: 40, deltaY: 60, deltaMode: 0, clientX: 600, clientY: 400 });
        m.stub.flushFrames();
      }
      assert.notEqual(m.cam(), cam0, "the camera moved");
      await m.settle();
      assert.equal(m.shells(), shells, "no shell built");
      assert.equal(m.cards(), 0, "no card shell attached");
      assert.equal(m.draws(), draws, "no redraw for a pan");
      assert.ok(m.shown());
    } finally { m.done(); }
  });
});

test("zooming into the map band brings shells back nearest-first under the budget; the boxes stay until they exist", async () => {
  await withFrozenClock(async () => {
    const m = mount(OVERVIEW);
    try {
      await m.pump(60);
      await m.settle();
      // Map zoom over the top-left of the board.
      m.view.restoreViewport({ x: 0, y: 0, zoom: 0.3 });
      m.stub.flushFrames();
      await tick(160);
      // Frames are counted; the background pump (idle, its own 25% budget) runs between them and is not, because
      // a frozen clock never ends its time slice here.
      let worst = 0;
      let frames = 0;
      while (frames < 300) {
        if (!m.shown()) break;
        const before = m.cards();
        m.stub.flushFrames();
        worst = Math.max(worst, m.cards() - before);
        m.stub.flushIdle();
        frames += 1;
      }
      assert.equal(m.view.state().lod, "map");
      assert.ok(worst <= 48, `at most one slice of shells per frame (worst ${worst})`);
      assert.ok(m.cards() > 20, `the cards in view are shells again (${m.cards()})`);
      assert.equal(m.shown(), false, "the underlay hides once they exist");
      // bc00000 is in view at this camera.
      assert.ok(m.view.root.querySelector("[data-uid=bc00000]"), "a card in view is a real shell");
    } finally { m.done(); }
  });
});

test("at overview a click selects from the model on release, a drag pans, and hover builds nothing", async () => {
  await withFrozenClock(async () => {
    const m = mount(OVERVIEW);
    try {
      await m.pump(60);
      await m.settle();
      const p = at(OVERVIEW, 164, 148);
      const shells = m.shells();
      m.stub.dispatch(m.view.root, "pointermove", { ...p, buttons: 0, pointerId: 1 });
      await m.pump(2);
      assert.equal(m.shells(), shells, "hover does not build the card");
      m.stub.dispatch(m.view.root, "pointerdown", { ...p, button: 0, buttons: 1, pointerId: 2 });
      assert.deepEqual(m.view.state().selection, [], "a press alone does not select");
      assert.equal(m.shells(), shells, "a press builds nothing");
      m.stub.dispatch(m.view.root, "pointerup", { ...p, button: 0, buttons: 0, pointerId: 2 });
      assert.deepEqual(m.view.state().selection, ["bc00000"]);
      await m.pump(2);
      assert.ok(m.view.root.querySelector("[data-uid=bc00000]"), "the selected card is a real shell");
      assert.equal(m.shells(), shells + 1, "one shell: the selected card");
      // A drag from another card pans and keeps the selection.
      const q = at(OVERVIEW, 384, 148);
      const vp0 = m.cam();
      m.stub.dispatch(m.view.root, "pointerdown", { ...q, button: 0, buttons: 1, pointerId: 3 });
      m.stub.dispatch(m.view.root, "pointermove", { clientX: q.clientX + 60, clientY: q.clientY + 40, buttons: 1, pointerId: 3 });
      m.stub.dispatch(m.view.root, "pointerup", { clientX: q.clientX + 60, clientY: q.clientY + 40, button: 0, buttons: 0, pointerId: 3 });
      m.stub.flushFrames();
      assert.notEqual(m.cam(), vp0, "the drag panned");
      assert.deepEqual(m.view.state().selection, ["bc00000"]);
      // A click on empty space still clears.
      m.stub.dispatch(m.view.root, "pointerdown", { clientX: 5, clientY: 880, button: 0, buttons: 1, pointerId: 4 });
      m.stub.dispatch(m.view.root, "pointerup", { clientX: 5, clientY: 880, button: 0, buttons: 0, pointerId: 4 });
      assert.deepEqual(m.view.state().selection, []);
    } finally { m.done(); }
  });
});

test("a marquee at overview selects from the model and builds at most the primary shell", async () => {
  await withFrozenClock(async () => {
    const m = mount(OVERVIEW);
    try {
      await m.pump(60);
      await m.settle();
      const shells = m.shells();
      const a = at(OVERVIEW, 20, 20); // outside every section
      const b = at(OVERVIEW, 720, 230);
      m.stub.dispatch(m.view.root, "pointerdown", { ...a, button: 0, buttons: 1, shiftKey: true, pointerId: 5 });
      m.stub.dispatch(m.view.root, "pointermove", { ...b, buttons: 1, shiftKey: true, pointerId: 5 });
      m.stub.dispatch(m.view.root, "pointerup", { ...b, button: 0, buttons: 0, shiftKey: true, pointerId: 5 });
      await m.pump(2);
      const sel = m.view.state().selection;
      assert.ok(sel.length >= 3, `marquee selected ${JSON.stringify(sel)}`);
      assert.ok(m.shells() <= shells + 1, `shells ${shells} → ${m.shells()}`);
      assert.ok(m.draws() >= 2, "the canvas redrew the selection");
    } finally { m.done(); }
  });
});

test("search, focus, the dust and strength lenses, memory lane and drag preview at overview build no card shell", async () => {
  await withFrozenClock(async () => {
    const m = mount(OVERVIEW);
    try {
      await m.pump(60);
      await m.settle();
      const root = m.view.root;
      // Search: Cmd+F with the pointer over the board, then type.
      m.stub.dispatch(root, "pointerenter", {});
      root.focus();
      m.stub.dispatch(m.stub.window, "keydown", { key: "f", metaKey: true });
      const input = root.querySelector(".pxd-search__input");
      assert.ok(input, "the board search is open");
      {
        const before = m.draws();
        input.value = "1";
        m.stub.dispatch(input, "input", {});
        await m.pump(2);
        assert.equal(m.cards(), 0, "search builds no card shell");
        assert.ok(m.draws() > before, "search dims on the canvas");
        input.value = "";
        m.stub.dispatch(input, "input", {});
      }
      // Select one card, then focus mode.
      const p = at(OVERVIEW, 164, 148);
      m.stub.dispatch(root, "pointerdown", { ...p, button: 0, buttons: 1, pointerId: 2 });
      m.stub.dispatch(root, "pointerup", { ...p, button: 0, buttons: 0, pointerId: 2 });
      await m.pump(2);
      const shells = m.shells();
      const drawsBeforeFocus = m.draws();
      assert.ok(root.querySelector(".pxd-toolbar__focus"));
      root.querySelector(".pxd-toolbar__focus").click();
      await m.pump(2);
      assert.equal(m.shells(), shells, "focus builds no shell");
      assert.ok(m.draws() > drawsBeforeFocus, "focus dims on the canvas");
      root.querySelector(".pxd-toolbar__focus")?.click();
      await m.pump(2);
      for (const id of ["lens-dust:6 months", "lens-strength", "memory-lane"]) {
        root.querySelector(".pxd-toolbar__more")?.click();
        const row = rowFor(root, id);
        assert.ok(row, `menu row ${id}`);
        row.click();
        await m.pump(3);
        assert.equal(m.shells(), shells, `${id} builds no shell`);
        assert.equal(m.cards() <= 1, true, `${id}: only the selected card is in the DOM`);
      }
      m.stub.dispatch(m.stub.window, "keydown", { key: "Escape" });
      await m.pump(2);
      // Drag preview: press the selected card's shell and move it.
      const el = root.querySelector("[data-uid=bc00000]");
      assert.ok(el, "the selected card has a shell to drag");
      {
        m.stub.dispatch(el, "pointerdown", { ...p, button: 0, buttons: 1, pointerId: 9 });
        m.stub.dispatch(el, "pointermove", { clientX: p.clientX + 30, clientY: p.clientY + 20, buttons: 1, pointerId: 9 });
        m.stub.flushFrames();
        m.stub.dispatch(el, "pointermove", { clientX: p.clientX + 50, clientY: p.clientY + 30, buttons: 1, pointerId: 9 });
        m.stub.flushFrames();
        assert.ok(m.shells() <= shells, "drag preview builds no shell");
        m.stub.dispatch(m.stub.window, "keydown", { key: "Escape" });
        m.stub.dispatch(el, "pointerup", { clientX: p.clientX + 50, clientY: p.clientY + 30, button: 0, buttons: 0, pointerId: 9 });
      }
    } finally { m.done(); }
  });
});

test("a double click on a canvas card opens that one card, not a new card", async () => {
  await withFrozenClock(async () => {
    const m = mount(OVERVIEW);
    try {
      await m.pump(60);
      await m.settle();
      const items = m.board.items.size;
      const p = at(OVERVIEW, 164, 148);
      m.stub.dispatch(m.view.root, "dblclick", { ...p, button: 0 });
      await m.pump(2);
      assert.deepEqual(m.view.state().selection, ["bc00000"]);
      assert.equal(m.board.items.size, items, "no card was created");
    } finally { m.done(); }
  });
});

test("zooming out from the map band to overview detaches the card shells and draws all of them on the canvas", async () => {
  await withFrozenClock(async () => {
    const m = mount({ x: 0, y: 0, zoom: 0.3 });
    try {
      await m.pump(200);
      await m.settle();
      assert.equal(m.view.state().lod, "map");
      assert.ok(m.cards() > 20, "map zoom has card shells");
      m.view.restoreViewport(OVERVIEW);
      m.stub.flushFrames();
      await m.settle();
      await m.settle();
      assert.equal(m.view.state().lod, "overview");
      assert.equal(m.cards(), 0, "the card shells left the DOM");
      assert.ok(m.shown());
      assert.equal(m.view.overviewCanvasStats().items, 1500, "every card but the 24 board cards (real shells) is on the canvas");
      assert.equal(m.boardCards(), 24);
      assert.equal(m.view.root.querySelectorAll(".pxd-edge").length, 0);
    } finally { m.done(); }
  });
});
