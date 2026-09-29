import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { createInteractions } from "../src/view/interactions.js";

function pulled() {
  const item = (uid, string, plexus, children = []) => ({
    ":block/uid": uid,
    ":block/string": string,
    ":block/order": 0,
    ":block/props": plexus ? { ":plexus": plexus } : {},
    ":block/children": children,
  });
  return {
    ":block/uid": "board0001",
    ":block/string": "{{[[diagram]]:Test}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": [
      { ...item("cardAAAA1", "Alpha", { ":x": 0, ":y": 0, ":w": 200, ":h": 100 }), ":block/order": 0 },
      { ...item("cardBBBB2", "[[Beta]]", { ":x": 400, ":y": 0, ":w": 200, ":h": 100 }), ":block/order": 1 },
      { ...item("sectCCCC3", "Evidence", { ":type": "section", ":x": 0, ":y": 300, ":w": 400, ":h": 300 }, [
        item("cardDDDD4", "Inside", { ":x": 20, ":y": 60, ":w": 200, ":h": 100 }),
      ]), ":block/order": 2 },
      { ...item("boardGGGG7", "{{[[diagram]]:Inner}}", { ":x": 1300, ":y": 400, ":w": 320, ":h": 220, ":v": 2 }), ":block/order": 4 },
      { ...item("edgesEEE5", "Connections", { ":type": "edges" }, [
        item("edgeFFFF6", "((cardAAAA1)) → [[Beta]]", { ":type": "edge", ":from": "cardAAAA1", ":to": "cardBBBB2" }),
      ]), ":block/order": 3 },
    ],
  };
}

function harness({ vp = { x: 0, y: 0, zoom: 1 }, settings = {}, editing = null, canPop = false } = {}) {
  const board = buildBoard(pulled());
  const rects = worldRects(board);
  const calls = [];
  const rec = (name) => (...args) => { calls.push([name, ...args]); };
  let uidCounter = 0;
  const actions = {
    board: () => board,
    rects: () => rects,
    viewport: () => vp,
    size: () => ({ width: 800, height: 600 }),
    setViewport: (v) => { vp = v; calls.push(["setViewport", v]); },
    onSelection: rec("onSelection"),
    onTool: rec("onTool"),
    onHover: rec("onHover"),
    setGesturing: rec("setGesturing"),
    showMarquee: rec("showMarquee"),
    showGuides: rec("showGuides"),
    previewMove: rec("previewMove"),
    previewRects: rec("previewRects"),
    showTempWire: rec("showTempWire"),
    commitMove: rec("commitMove"),
    commitRects: rec("commitRects"),
    createCard: (p) => { calls.push(["createCard", p]); return Promise.resolve(`new${uidCounter += 1}`); },
    createText: (p) => { calls.push(["createText", p]); return Promise.resolve(`txt${uidCounter += 1}`); },
    createSection: (p) => { calls.push(["createSection", p]); return Promise.resolve(`sec${uidCounter += 1}`); },
    wrapInSection: rec("wrapInSection"),
    createBoard: (p) => { calls.push(["createBoard", p]); return Promise.resolve(`brd${uidCounter += 1}`); },
    moveIntoBoard: rec("moveIntoBoard"),
    openBoard: rec("openBoard"),
    popBoard: () => { calls.push(["popBoard"]); return canPop; },
    deleteItems: rec("deleteItems"),
    deleteEdges: rec("deleteEdges"),
    addEdge: (p) => { calls.push(["addEdge", p]); return Promise.resolve(`edge${uidCounter += 1}`); },
    undo: rec("undo"),
    redo: rec("redo"),
    enterEdit: rec("enterEdit"),
    exitEdit: rec("exitEdit"),
    isEditing: () => Boolean(editing),
    editingUid: () => editing,
    autocompleteOpen: () => false,
    renameSection: rec("renameSection"),
    editLabel: rec("editLabel"),
    openBlock: rec("openBlock"),
    toast: rec("toast"),
    openSearch: rec("openSearch"),
    cycleLinks: rec("cycleLinks"),
    isFullscreen: () => false,
    setFullscreen: rec("setFullscreen"),
    setSpace: rec("setSpace"),
    fitAll: rec("fitAll"),
    fitSelection: rec("fitSelection"),
  };
  const ctl = createInteractions({ actions, settings: { get: (k) => settings[k] } });
  const named = (name) => calls.filter((c) => c[0] === name);
  const ev = (type, world, extra = {}) => ({
    type,
    screen: { x: world.x * vp.zoom + vp.x, y: world.y * vp.zoom + vp.y },
    world,
    target: { kind: "empty" },
    button: 0,
    buttons: 1,
    shift: false,
    alt: false,
    meta: false,
    ctrl: false,
    ...extra,
  });
  return { board, rects, ctl, calls, named, ev, get vp() { return vp; } };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test("section tool: one click creates exactly one default section centered on the click", async () => {
  const h = harness();
  h.ctl.setTool("section");
  h.ctl.handle(h.ev("pointerdown", { x: 1000, y: 1000 }));
  h.ctl.handle(h.ev("pointerup", { x: 1000, y: 1000 }));
  await tick();
  const creates = h.named("createSection");
  assert.equal(creates.length, 1);
  assert.deepEqual(creates[0][1].rect, { x: 760, y: 840, w: 480, h: 320 });
  assert.equal(h.ctl.getTool(), "select", "tool reverts after one use");
  assert.deepEqual(h.ctl.getSelection().items, ["sec1"], "new section is selected once created");
});

test("section tool: one drag creates exactly one section of the dragged rect", async () => {
  const h = harness();
  h.ctl.setTool("section");
  h.ctl.handle(h.ev("pointerdown", { x: 700, y: 100 }));
  h.ctl.handle(h.ev("pointermove", { x: 800, y: 150 }));
  h.ctl.handle(h.ev("pointermove", { x: 1000, y: 400 }));
  h.ctl.handle(h.ev("pointerup", { x: 1000, y: 400 }));
  h.ctl.handle(h.ev("dblclick", { x: 1000, y: 400 }, { target: { kind: "chrome" } }));
  await tick();
  const creates = h.named("createSection");
  assert.equal(creates.length, 1);
  assert.deepEqual(creates[0][1].rect, { x: 700, y: 100, w: 300, h: 300 });
  assert.ok(h.named("showMarquee").some((c) => c[2] === "section"), "drag previews the section rect");
  assert.equal(h.named("createCard").length, 0);
});

test("tool Shift-lock keeps the section tool after a gesture; plain select reverts", async () => {
  const h = harness();
  h.ctl.setTool("section", true);
  assert.equal(h.ctl.isLocked(), true);
  h.ctl.handle(h.ev("pointerdown", { x: 900, y: 900 }));
  h.ctl.handle(h.ev("pointerup", { x: 900, y: 900 }));
  await tick();
  assert.equal(h.ctl.getTool(), "section");
  h.ctl.handle(h.ev("pointerdown", { x: 1500, y: 900 }));
  h.ctl.handle(h.ev("pointerup", { x: 1500, y: 900 }));
  await tick();
  assert.equal(h.named("createSection").length, 2);
  h.ctl.setTool("card");
  assert.equal(h.ctl.isLocked(), false);
  h.ctl.handle(h.ev("pointerdown", { x: 1500, y: 1500 }));
  h.ctl.handle(h.ev("pointerup", { x: 1500, y: 1500 }));
  await tick();
  assert.equal(h.ctl.getTool(), "select");
  assert.equal(h.named("createCard").length, 1);
  assert.equal(h.named("enterEdit").length, 1, "new card enters edit");
});

test("marquee selects contained items and a plain click on empty clears selection", () => {
  const h = harness();
  h.ctl.handle(h.ev("pointerdown", { x: -50, y: -50 }));
  h.ctl.handle(h.ev("pointermove", { x: 700, y: 150 }));
  assert.deepEqual(h.ctl.getSelection().items.sort(), ["cardAAAA1", "cardBBBB2"]);
  h.ctl.handle(h.ev("pointerup", { x: 700, y: 150 }));
  assert.deepEqual(h.ctl.getSelection().items.sort(), ["cardAAAA1", "cardBBBB2"]);
  assert.ok(h.named("showMarquee").some((c) => c[1] && c[2] === "select"));
  h.ctl.handle(h.ev("pointerdown", { x: 2000, y: 2000 }));
  h.ctl.handle(h.ev("pointerup", { x: 2000, y: 2000 }));
  assert.deepEqual(h.ctl.getSelection().items, []);
  assert.equal(h.named("commitMove").length, 0);
  assert.equal(h.named("setViewport").length, 0, "marquee never pans");
});

test("move: no commit under the 4 px threshold, exactly one commitMove after a drag, guides during", () => {
  const h = harness();
  const item = { kind: "item", uid: "cardAAAA1", part: "body" };
  h.ctl.handle(h.ev("pointerdown", { x: 10, y: 10 }, { target: item }));
  h.ctl.handle(h.ev("pointermove", { x: 12, y: 12 }, { target: item }));
  h.ctl.handle(h.ev("pointerup", { x: 12, y: 12 }, { target: item }));
  assert.equal(h.named("commitMove").length, 0);
  assert.equal(h.named("previewMove").length, 0);
  assert.deepEqual(h.ctl.getSelection().items, ["cardAAAA1"]);

  h.ctl.handle(h.ev("pointerdown", { x: 10, y: 10 }, { target: item }));
  h.ctl.handle(h.ev("pointermove", { x: 60, y: 30 }, { target: item }));
  h.ctl.handle(h.ev("pointermove", { x: 110, y: 50 }, { target: item }));
  h.ctl.handle(h.ev("pointerup", { x: 110, y: 50 }, { target: item }));
  const commits = h.named("commitMove");
  assert.equal(commits.length, 1);
  assert.deepEqual(commits[0][1], ["cardAAAA1"]);
  assert.equal(commits[0][2], 100);
  assert.equal(commits[0][3], 40);
  assert.ok(h.named("previewMove").length >= 2);
  const guides = h.named("showGuides");
  assert.ok(guides.some((c) => c[1].length > 0), "alignment guides appear when top edges align (y=0 vs y=40? snapped to Beta top)");
});

test("move snaps to a neighbour edge within 6 screen px", () => {
  const h = harness();
  const item = { kind: "item", uid: "cardAAAA1", part: "body" };
  h.ctl.handle(h.ev("pointerdown", { x: 10, y: 10 }, { target: item }));
  h.ctl.handle(h.ev("pointermove", { x: 60, y: 14 }, { target: item }));
  h.ctl.handle(h.ev("pointerup", { x: 60, y: 14 }, { target: item }));
  const [, , dx, dy] = h.named("commitMove")[0];
  assert.equal(dx, 50);
  assert.equal(dy, 0, "4 px vertical drift snaps back to Beta's top edge");
});

test("connect: drop on another item adds one edge with sides; drop on the same pair selects the existing edge", async () => {
  const h = harness();
  h.ctl.handle(h.ev("pointerdown", { x: 200, y: 50 }, { target: { kind: "port", uid: "cardAAAA1", side: "right" } }));
  h.ctl.handle(h.ev("pointermove", { x: 300, y: 50 }));
  h.ctl.handle(h.ev("pointermove", { x: 420, y: 90 }));
  assert.ok(h.named("showTempWire").some((c) => c[1]?.from === "cardAAAA1"));
  assert.ok(h.named("onHover").some((c) => c[1] === "cardBBBB2"), "hover highlights the drop target");
  h.ctl.handle(h.ev("pointerup", { x: 420, y: 90 }));
  await tick();
  assert.equal(h.named("addEdge").length, 0, "A→Beta already exists");
  assert.equal(h.ctl.getSelection().edge, "edgeFFFF6");

  h.ctl.handle(h.ev("pointerdown", { x: 400, y: 100 }, { target: { kind: "port", uid: "cardBBBB2", side: "bottom" } }));
  h.ctl.handle(h.ev("pointermove", { x: 300, y: 300 }));
  h.ctl.handle(h.ev("pointerup", { x: 100, y: 90 }));
  await tick();
  const adds = h.named("addEdge");
  assert.equal(adds.length, 1);
  assert.deepEqual(adds[0][1], { from: "cardBBBB2", to: "cardAAAA1", fromSide: "bottom", toSide: "bottom" });
  assert.equal(h.ctl.getSelection().edge, "edge1");
  assert.ok(h.named("showTempWire").at(-1)[1] === null, "temp wire cleared");
});

test("connect: drop on empty creates a card, an edge, and enters edit; drop on self adds nothing", async () => {
  const h = harness();
  h.ctl.handle(h.ev("pointerdown", { x: 200, y: 50 }, { target: { kind: "port", uid: "cardAAAA1", side: "right" } }));
  h.ctl.handle(h.ev("pointermove", { x: 900, y: 50 }));
  h.ctl.handle(h.ev("pointerup", { x: 900, y: 50 }));
  await tick();
  await tick();
  assert.equal(h.named("createCard").length, 1);
  assert.deepEqual(h.named("createCard")[0][1], { x: 900, y: -30 });
  assert.deepEqual(h.named("addEdge")[0][1], { from: "cardAAAA1", to: "new1", fromSide: "right", toSide: "auto" });
  assert.deepEqual(h.named("enterEdit")[0][1], "new1");

  h.ctl.handle(h.ev("pointerdown", { x: 200, y: 50 }, { target: { kind: "port", uid: "cardAAAA1", side: "right" } }));
  h.ctl.handle(h.ev("pointermove", { x: 100, y: 60 }));
  h.ctl.handle(h.ev("pointerup", { x: 100, y: 60 }));
  await tick();
  assert.equal(h.named("addEdge").length, 1, "self drop adds no edge");
  assert.equal(h.named("createCard").length, 1);
  assert.deepEqual(h.ctl.getSelection().items, ["cardAAAA1"]);
});

test("connect tool: drag from an item body starts from the nearest side; a section under the drop is a valid target", async () => {
  const h = harness();
  h.ctl.setTool("connect");
  h.ctl.handle(h.ev("pointerdown", { x: 100, y: 95 }, { target: { kind: "item", uid: "cardAAAA1", part: "body" } }));
  h.ctl.handle(h.ev("pointermove", { x: 300, y: 450 }));
  h.ctl.handle(h.ev("pointerup", { x: 300, y: 450 }));
  await tick();
  const add = h.named("addEdge")[0][1];
  assert.equal(add.from, "cardAAAA1");
  assert.equal(add.fromSide, "bottom");
  assert.equal(add.to, "sectCCCC3");
  assert.equal(h.ctl.getTool(), "select");
});

test("Esc chain: cancel gesture → exit edit → clear selection → exit fullscreen", () => {
  let editing = "cardAAAA1";
  const h = harness({ editing });
  h.ctl.select(["cardAAAA1"]);
  assert.equal(h.ctl.handle({ type: "keydown", key: "Escape" }), true);
  assert.equal(h.named("exitEdit").length, 1);
  const h2 = harness();
  h2.ctl.select(["cardAAAA1"]);
  h2.ctl.handle({ type: "keydown", key: "Escape" });
  assert.deepEqual(h2.ctl.getSelection().items, []);
  assert.equal(h2.named("setFullscreen").length, 0);
  const h3 = harness();
  h3.ctl.handle(h3.ev("pointerdown", { x: 200, y: 50 }, { target: { kind: "port", uid: "cardAAAA1", side: "right" } }));
  h3.ctl.handle(h3.ev("pointermove", { x: 600, y: 50 }));
  h3.ctl.handle({ type: "keydown", key: "Escape" });
  assert.equal(h3.ctl.isGesturing(), false);
  assert.equal(h3.named("showTempWire").at(-1)[1], null);
});

test("keyboard shortcuts are ignored while an input has focus (except Esc leaving edit mode)", () => {
  const h = harness({ editing: "cardAAAA1" });
  h.ctl.select(["cardAAAA1"]);
  assert.equal(h.ctl.handle({ type: "keydown", key: "Delete", inputFocused: true }), false);
  assert.equal(h.named("deleteItems").length, 0);
  assert.equal(h.ctl.handle({ type: "keydown", key: "g", inputFocused: true }), false);
  assert.equal(h.ctl.getTool(), "select");
  assert.equal(h.ctl.handle({ type: "keydown", key: "Escape", inputFocused: true }), true);
  assert.equal(h.named("exitEdit").length, 1);
});

test("Delete removes the selection with an Undo toast; Shift+Delete deletes section contents", () => {
  const h = harness();
  h.ctl.select(["sectCCCC3"]);
  h.ctl.handle({ type: "keydown", key: "Delete" });
  assert.deepEqual(h.named("deleteItems")[0].slice(1), [["sectCCCC3"], { withContents: false }]);
  const toast = h.named("toast")[0][1];
  assert.equal(toast.action.label, "Undo");
  toast.action.run();
  assert.equal(h.named("undo").length, 1);
  h.ctl.select(["sectCCCC3"]);
  h.ctl.handle({ type: "keydown", key: "Backspace", shift: true });
  assert.deepEqual(h.named("deleteItems")[1][2], { withContents: true });
});

test("keyboard map: tools, fit, zoom, links, search, wrap, undo/redo, Enter edits", () => {
  const h = harness();
  h.ctl.handle({ type: "keydown", key: "h" });
  assert.equal(h.ctl.getTool(), "hand");
  h.ctl.handle({ type: "keydown", key: "v" });
  h.ctl.handle({ type: "keydown", key: "!", code: "Digit1", shift: true });
  assert.equal(h.named("fitAll").length, 1);
  h.ctl.handle({ type: "keydown", key: "l" });
  assert.equal(h.named("cycleLinks").length, 1);
  h.ctl.handle({ type: "keydown", key: "/" });
  assert.equal(h.named("openSearch").length, 1);
  h.ctl.select(["cardAAAA1", "cardBBBB2"]);
  h.ctl.handle({ type: "keydown", key: "g", meta: true });
  assert.deepEqual(h.named("wrapInSection")[0][1], ["cardAAAA1", "cardBBBB2"]);
  h.ctl.handle({ type: "keydown", key: "z", meta: true });
  h.ctl.handle({ type: "keydown", key: "z", meta: true, shift: true });
  assert.equal(h.named("undo").length, 1);
  assert.equal(h.named("redo").length, 1);
  h.ctl.handle({ type: "keydown", key: "=", meta: true });
  assert.ok(h.vp.zoom > 1);
  h.ctl.handle({ type: "keydown", key: ")", code: "Digit0", shift: true });
  assert.ok(Math.abs(h.vp.zoom - 1) < 1e-9);
  h.ctl.select(["cardAAAA1"]);
  h.ctl.handle({ type: "keydown", key: "Enter" });
  assert.deepEqual(h.named("enterEdit").at(-1)[1], "cardAAAA1");
  h.ctl.handle({ type: "keydown", key: "ArrowRight", shift: true });
  assert.deepEqual(h.named("commitMove").at(-1).slice(1), [["cardAAAA1"], 10, 0]);
});

test("wheel: plain wheel pans, ctrl/meta wheel zooms at the cursor; hand tool and space pan by drag", () => {
  const h = harness();
  h.ctl.handle(h.ev("wheel", { x: 100, y: 100 }, { deltaX: 10, deltaY: 20 }));
  assert.deepEqual(h.vp, { x: -10, y: -20, zoom: 1 });
  h.ctl.handle(h.ev("wheel", { x: 100, y: 100 }, { deltaY: -100, ctrl: true }));
  assert.ok(h.vp.zoom > 1);
  const before = h.named("setViewport").length;
  h.ctl.handle({ type: "keydown", key: " ", code: "Space" });
  h.ctl.handle(h.ev("pointerdown", { x: 0, y: 0 }, { target: { kind: "item", uid: "cardAAAA1", part: "body" } }));
  h.ctl.handle(h.ev("pointermove", { x: 50, y: 50 }));
  h.ctl.handle(h.ev("pointerup", { x: 50, y: 50 }));
  h.ctl.handle({ type: "keyup", key: " ", code: "Space" });
  assert.ok(h.named("setViewport").length > before, "space-drag pans even over an item");
  assert.equal(h.named("commitMove").length, 0);
  assert.equal(h.named("createCard").length, 0);
});

test("wheel setting 'zoom' swaps plain wheel to zoom", () => {
  const h = harness({ settings: { wheel: "zoom" } });
  h.ctl.handle(h.ev("wheel", { x: 0, y: 0 }, { deltaY: -50 }));
  assert.ok(h.vp.zoom > 1);
});

test("resize grip: min sizes enforced and one commitRects", () => {
  const h = harness();
  const grip = { kind: "grip", uid: "cardAAAA1", part: "corner" };
  h.ctl.handle(h.ev("pointerdown", { x: 200, y: 100 }, { target: grip }));
  h.ctl.handle(h.ev("pointermove", { x: 100, y: 20 }, { target: grip }));
  h.ctl.handle(h.ev("pointerup", { x: 100, y: 20 }, { target: grip }));
  assert.deepEqual(h.named("commitRects")[0][1], [{ uid: "cardAAAA1", x: 0, y: 0, w: 200, h: 80 }]);
  h.ctl.handle(h.ev("pointerdown", { x: 200, y: 100 }, { target: { ...grip, part: "right" } }));
  h.ctl.handle(h.ev("pointermove", { x: 300, y: 300 }, { target: grip }));
  h.ctl.handle(h.ev("pointerup", { x: 300, y: 300 }, { target: grip }));
  assert.deepEqual(h.named("commitRects")[1][1], [{ uid: "cardAAAA1", x: 0, y: 0, w: 300, h: 100 }]);
});

test("double-click: empty creates a card and edits; item enters edit; board card opens; section title renames", async () => {
  const h = harness();
  h.ctl.handle(h.ev("dblclick", { x: 1000, y: 1000 }));
  await tick();
  assert.deepEqual(h.named("createCard")[0][1], { x: 860, y: 920 });
  assert.equal(h.named("enterEdit").length, 1);
  h.ctl.handle(h.ev("dblclick", { x: 10, y: 10 }, { target: { kind: "item", uid: "cardAAAA1", part: "body" } }));
  assert.deepEqual(h.named("enterEdit").at(-1)[1], "cardAAAA1");
  h.ctl.handle(h.ev("dblclick", { x: 10, y: 310 }, { target: { kind: "section-title", uid: "sectCCCC3" } }));
  assert.deepEqual(h.named("renameSection")[0][1], "sectCCCC3");
  h.ctl.handle(h.ev("dblclick", { x: 300, y: 50 }, { target: { kind: "label", uid: "edgeFFFF6" } }));
  assert.deepEqual(h.named("editLabel")[0][1], "edgeFFFF6");
});

test("pan, marquee and wheel never call session mutations", () => {
  const h = harness();
  h.ctl.setTool("hand");
  h.ctl.handle(h.ev("pointerdown", { x: 0, y: 0 }));
  h.ctl.handle(h.ev("pointermove", { x: 300, y: 300 }));
  h.ctl.handle(h.ev("pointerup", { x: 300, y: 300 }));
  h.ctl.setTool("select");
  h.ctl.handle(h.ev("pointerdown", { x: -100, y: -100 }));
  h.ctl.handle(h.ev("pointermove", { x: 900, y: 900 }));
  h.ctl.handle(h.ev("pointerup", { x: 900, y: 900 }));
  h.ctl.handle(h.ev("wheel", { x: 0, y: 0 }, { deltaY: 30 }));
  const mutations = ["commitMove", "commitRects", "createCard", "createText", "createSection", "addEdge", "deleteItems", "deleteEdges", "wrapInSection"];
  for (const m of mutations) assert.equal(h.named(m).length, 0, `${m} not called`);
});

test("W selects the Board tool", () => {
  const h = harness();
  h.ctl.handle({ type: "keydown", key: "w" });
  assert.equal(h.ctl.getTool(), "board");
});

test("board tool: one click creates exactly one default-size board centered on the click", async () => {
  const h = harness();
  h.ctl.setTool("board");
  h.ctl.handle(h.ev("pointerdown", { x: 1500, y: 1000 }));
  h.ctl.handle(h.ev("pointerup", { x: 1500, y: 1000 }));
  await tick();
  const creates = h.named("createBoard");
  assert.equal(creates.length, 1);
  assert.deepEqual(creates[0][1].rect, { x: 1340, y: 890, w: 320, h: 220 });
  assert.equal(h.ctl.getTool(), "select");
  assert.deepEqual(h.ctl.getSelection().items, ["brd1"]);
  assert.equal(h.named("createCard").length, 0);
});

test("board tool: a drag creates one board of the dragged rect; a tiny drag falls back to the default", async () => {
  const h = harness();
  h.ctl.setTool("board");
  h.ctl.handle(h.ev("pointerdown", { x: 1300, y: 100 }));
  h.ctl.handle(h.ev("pointermove", { x: 1400, y: 200 }));
  h.ctl.handle(h.ev("pointermove", { x: 1700, y: 400 }));
  h.ctl.handle(h.ev("pointerup", { x: 1700, y: 400 }));
  await tick();
  assert.equal(h.named("createBoard").length, 1);
  assert.deepEqual(h.named("createBoard")[0][1].rect, { x: 1300, y: 100, w: 400, h: 300 });
  assert.ok(h.named("showMarquee").some((c) => c[2] === "board"));
  h.ctl.setTool("board");
  h.ctl.handle(h.ev("pointerdown", { x: 2000, y: 100 }));
  h.ctl.handle(h.ev("pointermove", { x: 2050, y: 130 }));
  h.ctl.handle(h.ev("pointerup", { x: 2050, y: 130 }));
  await tick();
  assert.deepEqual(h.named("createBoard")[1][1].rect, { x: 1840, y: -10, w: 320, h: 220 });
});

test("board tool over an existing item still draws (items count as empty space)", async () => {
  const h = harness();
  h.ctl.setTool("board");
  const item = { kind: "item", uid: "cardAAAA1", part: "body" };
  h.ctl.handle(h.ev("pointerdown", { x: 10, y: 10 }, { target: item }));
  h.ctl.handle(h.ev("pointerup", { x: 10, y: 10 }, { target: item }));
  await tick();
  assert.equal(h.named("createBoard").length, 1);
  assert.equal(h.named("commitMove").length, 0);
});

test("dragging a card over a board card highlights it and drops through moveIntoBoard, not commitMove", () => {
  const h = harness();
  const item = { kind: "item", uid: "cardAAAA1", part: "body" };
  h.ctl.handle(h.ev("pointerdown", { x: 10, y: 10 }, { target: item }));
  h.ctl.handle(h.ev("pointermove", { x: 400, y: 100 }, { target: item }));
  assert.equal(h.named("onHover").filter((c) => c[1] === "boardGGGG7").length, 0);
  h.ctl.handle(h.ev("pointermove", { x: 1400, y: 500 }, { target: item }));
  assert.equal(h.named("onHover").at(-1)[1], "boardGGGG7");
  h.ctl.handle(h.ev("pointermove", { x: 1450, y: 520 }, { target: item }));
  assert.equal(h.named("onHover").filter((c) => c[1] === "boardGGGG7").length, 1, "hover is reported once per change");
  h.ctl.handle(h.ev("pointerup", { x: 1450, y: 520 }, { target: item }));
  assert.equal(h.named("moveIntoBoard").length, 1);
  assert.deepEqual(h.named("moveIntoBoard")[0].slice(1, 3), [["cardAAAA1"], "boardGGGG7"]);
  assert.equal(h.named("commitMove").length, 0);
  assert.equal(h.named("onHover").at(-1)[1], null, "highlight cleared on drop");
});

test("dragging away from a board card clears the drop target and commits a plain move", () => {
  const h = harness();
  const item = { kind: "item", uid: "cardAAAA1", part: "body" };
  h.ctl.handle(h.ev("pointerdown", { x: 10, y: 10 }, { target: item }));
  h.ctl.handle(h.ev("pointermove", { x: 1400, y: 500 }, { target: item }));
  h.ctl.handle(h.ev("pointermove", { x: 1500, y: 900 }, { target: item }));
  h.ctl.handle(h.ev("pointerup", { x: 1500, y: 900 }, { target: item }));
  assert.equal(h.named("moveIntoBoard").length, 0);
  assert.equal(h.named("commitMove").length, 1);
});

test("a board card dragged over itself is a plain move", () => {
  const h = harness();
  const item = { kind: "item", uid: "boardGGGG7", part: "body" };
  h.ctl.handle(h.ev("pointerdown", { x: 1400, y: 500 }, { target: item }));
  h.ctl.handle(h.ev("pointermove", { x: 1450, y: 520 }, { target: item }));
  h.ctl.handle(h.ev("pointerup", { x: 1450, y: 520 }, { target: item }));
  assert.equal(h.named("moveIntoBoard").length, 0);
  assert.equal(h.named("commitMove").length, 1);
  assert.ok(h.named("onHover").every((c) => c[1] !== "boardGGGG7"));
});

test("dblclick and Enter on a board card open it in place", () => {
  const h = harness();
  h.ctl.handle(h.ev("dblclick", { x: 1400, y: 500 }, { target: { kind: "item", uid: "boardGGGG7", part: "body" } }));
  assert.deepEqual(h.named("openBoard")[0].slice(1), ["boardGGGG7"]);
  assert.equal(h.named("openBlock").length, 0);
  h.ctl.select(["boardGGGG7"]);
  h.ctl.handle({ type: "keydown", key: "Enter" });
  assert.deepEqual(h.named("openBoard").at(-1).slice(1), ["boardGGGG7"]);
  assert.equal(h.named("enterEdit").length, 0);
});

test("Esc chain: clear selection, then pop a nested board, then leave fullscreen", () => {
  const h = harness({ canPop: true });
  h.ctl.select(["cardAAAA1"]);
  assert.equal(h.ctl.handle({ type: "keydown", key: "Escape" }), true);
  assert.deepEqual(h.ctl.getSelection().items, []);
  assert.equal(h.named("popBoard").length, 0, "selection clears first");
  assert.equal(h.ctl.handle({ type: "keydown", key: "Escape" }), true);
  assert.equal(h.named("popBoard").length, 1);
  assert.equal(h.named("setFullscreen").length, 0);
  const top = harness({ canPop: false });
  assert.equal(top.ctl.handle({ type: "keydown", key: "Escape" }), false, "at the top level Esc falls through");
  assert.equal(top.named("popBoard").length, 1);
});

test("plain-object settings are honored as well as settings.get", () => {
  const calls = [];
  const h = harness();
  const ctl = createInteractions({
    actions: { board: () => h.board, rects: () => h.rects, viewport: () => ({ x: 0, y: 0, zoom: 1 }), setViewport: (v) => calls.push(v) },
    settings: { wheel: "zoom" },
  });
  ctl.handle(h.ev("wheel", { x: 100, y: 100 }, { deltaY: 30 }));
  assert.ok(calls[0].zoom !== 1, "wheel setting 'zoom' read from a plain object zooms");
});
