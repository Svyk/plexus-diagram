import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { createInteractions } from "../src/view/interactions.js";
import { SHORTCUTS, findShortcut } from "../src/view/shortcuts.js";

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

function harness({ vp = { x: 0, y: 0, zoom: 1 }, settings = {}, editing = null, canPop = false, extra = {} } = {}) {
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
    animateViewport: (v) => { vp = v; calls.push(["animateViewport", v]); },
    onSelection: rec("onSelection"),
    onTool: rec("onTool"),
    onHover: rec("onHover"),
    setGesturing: rec("setGesturing"),
    showMarquee: rec("showMarquee"),
    showLasso: rec("showLasso"),
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
    historyBack: rec("historyBack"),
    historyForward: rec("historyForward"),
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
    openInfo: rec("openInfo"),
    addInfoTab: rec("addInfoTab"),
    cycleLinks: rec("cycleLinks"),
    isFullscreen: () => false,
    setFullscreen: rec("setFullscreen"),
    setSpace: rec("setSpace"),
    fitAll: rec("fitAll"),
    fitSelection: rec("fitSelection"),
    openMenu: rec("openMenu"),
    showGhosts: rec("showGhosts"),
    duplicateItems: rec("duplicateItems"),
    cancelPreview: rec("cancelPreview"),
    foldSelection: rec("foldSelection"),
    toggleFocus: rec("toggleFocus"),
    quickLook: rec("quickLook"),
    present: rec("present"),
    expandOutline: rec("expandOutline"),
    presentNext: rec("presentNext"),
    presentPrev: rec("presentPrev"),
    renamePage: rec("renamePage"),
    toggleShortcuts: rec("toggleShortcuts"),
    fitHeight: rec("fitHeight"),
    fitSection: rec("fitSection"),
    resetSize: rec("resetSize"),
    ...extra,
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

test("HB-11: Cmd+[ goes back and Cmd+] goes forward, and neither fires while a card is being typed", () => {
  const h = harness();
  const key = (extra) => h.ctl.handle({ type: "keydown", meta: true, ctrl: false, shift: false, alt: false, ...extra });
  key({ key: "[", code: "BracketLeft" });
  key({ key: "]", code: "BracketRight" });
  assert.equal(h.named("historyBack").length, 1);
  assert.equal(h.named("historyForward").length, 1);
  h.ctl.handle({ type: "keydown", key: "{", code: "BracketLeft", meta: true, shift: true, alt: false });
  assert.equal(h.named("historyBack").length, 1, "shift stays with the browser");
  const typing = harness({ editing: "cardAAAA1" });
  typing.ctl.handle({ type: "keydown", key: "[", code: "BracketLeft", meta: true, inputFocused: true });
  assert.equal(typing.named("historyBack").length, 0);
  assert.equal(typing.named("exitEdit").length, 0);
});

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

test("HB-10: Alt-drag on empty space lassos by center and Alt-drag on a card still duplicates", () => {
  const h = harness();
  h.ctl.handle(h.ev("pointerdown", { x: -30, y: 50 }, { alt: true }));
  h.ctl.handle(h.ev("pointermove", { x: 230, y: -30 }, { alt: true }));
  h.ctl.handle(h.ev("pointermove", { x: 100, y: 120 }, { alt: true }));
  assert.deepEqual(h.ctl.getSelection().items, ["cardAAAA1"]);
  assert.ok(h.named("showLasso").some((c) => Array.isArray(c[1]) && c[1].length >= 3));
  assert.equal(h.named("showMarquee").some((c) => c[1]), false, "the lasso does not draw the rectangle marquee");
  h.ctl.handle(h.ev("pointerup", { x: 100, y: 120 }, { alt: true }));
  assert.deepEqual(h.ctl.getSelection().items, ["cardAAAA1"]);
  assert.equal(h.named("duplicateItems").length, 0);
  assert.equal(h.named("commitMove").length, 0);

  h.ctl.select(["cardBBBB2"]);
  h.ctl.handle(h.ev("pointerdown", { x: -30, y: 50 }, { alt: true, shift: true }));
  h.ctl.handle(h.ev("pointermove", { x: 230, y: -30 }, { alt: true, shift: true }));
  h.ctl.handle(h.ev("pointermove", { x: 100, y: 120 }, { alt: true, shift: true }));
  h.ctl.handle(h.ev("pointerup", { x: 100, y: 120 }, { alt: true, shift: true }));
  const kept = h.ctl.getSelection().items;
  assert.ok(kept.includes("cardAAAA1") && kept.includes("cardBBBB2"));

  h.ctl.select(["cardAAAA1"]);
  h.ctl.handle(h.ev("pointerdown", { x: 2000, y: 2000 }, { alt: true }));
  h.ctl.handle(h.ev("pointermove", { x: 2100, y: 2000 }, { alt: true }));
  h.ctl.handle(h.ev("pointerup", { x: 2100, y: 2000 }, { alt: true }));
  assert.deepEqual(h.ctl.getSelection().items, [], "a line is not a lasso, so the selection is replaced with nothing");

  const card = { kind: "item", uid: "cardAAAA1", part: "body" };
  const lassos = () => h.named("showLasso").filter((c) => Array.isArray(c[1])).length;
  const beforeCard = lassos();
  h.ctl.handle(h.ev("pointerdown", { x: 10, y: 10 }, { target: card, alt: true }));
  h.ctl.handle(h.ev("pointermove", { x: 80, y: 40 }, { target: card, alt: true }));
  h.ctl.handle(h.ev("pointerup", { x: 80, y: 40 }, { target: card, alt: true }));
  assert.equal(h.named("duplicateItems").length, 1);
  assert.equal(lassos(), beforeCard, "the card drag did not start another lasso");
});

test("Cmd or Ctrl click toggles selection membership and does not edit", () => {
  const h = harness();
  const a = { kind: "item", uid: "cardAAAA1", part: "body" };
  const b = { kind: "item", uid: "cardBBBB2", part: "body" };
  h.ctl.handle(h.ev("pointerdown", { x: 10, y: 10 }, { target: a }));
  h.ctl.handle(h.ev("pointerup", { x: 10, y: 10 }, { target: a }));
  h.ctl.handle(h.ev("pointerdown", { x: 410, y: 10 }, { target: b, meta: true }));
  h.ctl.handle(h.ev("pointerup", { x: 410, y: 10 }, { target: b, meta: true }));
  assert.deepEqual(h.ctl.getSelection().items.sort(), ["cardAAAA1", "cardBBBB2"]);
  assert.equal(h.named("enterEdit").length, 0, "a click selects and does not edit");
  h.ctl.handle(h.ev("pointerdown", { x: 410, y: 10 }, { target: b, ctrl: true }));
  h.ctl.handle(h.ev("pointerup", { x: 410, y: 10 }, { target: b, ctrl: true }));
  assert.deepEqual(h.ctl.getSelection().items, ["cardAAAA1"]);
});

test("Shift-drag marquee keeps cards already selected", () => {
  const h = harness();
  h.ctl.select(["cardDDDD4"]);
  h.ctl.handle(h.ev("pointerdown", { x: -50, y: -50 }, { shift: true }));
  h.ctl.handle(h.ev("pointermove", { x: 250, y: 150 }, { shift: true }));
  h.ctl.handle(h.ev("pointerup", { x: 250, y: 150 }, { shift: true }));
  const items = h.ctl.getSelection().items;
  assert.ok(items.includes("cardAAAA1"));
  assert.ok(items.includes("cardDDDD4"));
  assert.equal(items.includes("cardBBBB2"), false);
});

test("Cmd-A selects every item and an arrow nudges by one pixel", () => {
  const h = harness();
  h.ctl.handle({ type: "keydown", key: "a", meta: true });
  for (const uid of ["cardAAAA1", "cardBBBB2", "sectCCCC3"]) assert.ok(h.ctl.getSelection().items.includes(uid));
  h.ctl.select(["cardAAAA1"]);
  h.ctl.handle({ type: "keydown", key: "ArrowRight" });
  assert.deepEqual(h.named("commitMove").at(-1).slice(1), [["cardAAAA1"], 1, 0]);
  h.ctl.handle({ type: "keydown", key: "Backspace" });
  assert.equal(h.named("deleteItems").at(-1)[2].withContents, false);
});

test("move: no commit under the 4 px threshold, exactly one commitMove after a drag, guides during", () => {
  const h = harness();
  const item = { kind: "item", uid: "cardAAAA1", part: "body" };
  h.ctl.handle(h.ev("pointerdown", { x: 10, y: 10 }, { target: item }));
  h.ctl.handle(h.ev("pointermove", { x: 12, y: 12 }, { target: item }));
  h.ctl.handle(h.ev("pointerup", { x: 12, y: 12 }, { target: item }));
  assert.equal(h.named("commitMove").length, 0);
  assert.equal(h.named("previewMove").length, 0);
  assert.equal(h.named("enterEdit").length, 0, "a click selects and does not edit");
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
  assert.equal(h.named("enterEdit").length, 0, "a drag does not edit");
  assert.ok(h.named("previewMove").length >= 2);
  const guides = h.named("showGuides");
  assert.ok(guides.some((c) => c[1].length > 0), "alignment guides appear when top edges align (y=0 vs y=40? snapped to Beta top)");
});

test("a page card click does not edit; look card keeps double-click edit", () => {
  const h = harness();
  const page = { kind: "item", uid: "cardBBBB2", part: "body" };
  h.ctl.handle(h.ev("pointerdown", { x: 410, y: 20 }, { target: page }));
  h.ctl.handle(h.ev("pointerup", { x: 410, y: 20 }, { target: page }));
  assert.equal(h.named("enterEdit").length, 0);
  h.board.items.get("cardAAAA1").look = "card";
  h.ctl.handle(h.ev("pointerdown", { x: 10, y: 10 }, { target: CARD }));
  h.ctl.handle(h.ev("pointerup", { x: 10, y: 10 }, { target: CARD }));
  assert.equal(h.named("enterEdit").length, 0);
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

test("snap to grid is off by default and snaps a near corner when turned on", () => {
  const item = { kind: "item", uid: "cardAAAA1", part: "body" };
  const off = harness();
  off.ctl.handle(off.ev("pointerdown", { x: 10, y: 10 }, { target: item }));
  off.ctl.handle(off.ev("pointermove", { x: 10, y: 36 }, { target: item }));
  assert.equal(off.named("commitMove").length, 0, "a drag writes nothing until pointerup");
  off.ctl.handle(off.ev("pointerup", { x: 10, y: 36 }, { target: item }));
  assert.deepEqual(off.named("commitMove")[0].slice(2), [0, 26]);

  const on = harness({ settings: { "snap-grid": true } });
  on.ctl.handle(on.ev("pointerdown", { x: 10, y: 10 }, { target: item }));
  on.ctl.handle(on.ev("pointermove", { x: 10, y: 36 }, { target: item }));
  assert.equal(on.named("commitMove").length, 0);
  on.ctl.handle(on.ev("pointerup", { x: 10, y: 36 }, { target: item }));
  assert.deepEqual(on.named("commitMove")[0].slice(2), [0, 24], "26px lands on the 24px grid");
});

test("Alt during a drag disables neighbour and grid snap", () => {
  const item = { kind: "item", uid: "cardAAAA1", part: "body" };
  const h = harness({ settings: { "snap-grid": true } });
  h.ctl.handle(h.ev("pointerdown", { x: 10, y: 10 }, { target: item }));
  h.ctl.handle(h.ev("pointermove", { x: 60, y: 14 }, { target: item, alt: true }));
  h.ctl.handle(h.ev("pointerup", { x: 60, y: 14 }, { target: item, alt: true }));
  assert.deepEqual(h.named("commitMove")[0].slice(2), [50, 4]);
  assert.ok(h.named("showGuides").every((c) => c[1].length === 0));
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

test("Delete removes the selection with an Undo toast; Shift+Delete deletes section contents", async () => {
  const h = harness();
  h.ctl.select(["sectCCCC3"]);
  h.ctl.handle({ type: "keydown", key: "Delete" });
  await Promise.resolve();
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
  h.ctl.handle({ type: "keydown", key: "f", meta: true });
  assert.equal(h.named("openSearch").length, 2);
  h.ctl.handle({ type: "keydown", key: "f", meta: true, inputFocused: true });
  assert.equal(h.named("openSearch").length, 2);
  h.ctl.handle({ type: "keydown", key: "I" });
  assert.equal(h.named("openInfo").length, 1);
  h.ctl.handle({ type: "keydown", key: "i", inputFocused: true });
  assert.equal(h.named("openInfo").length, 1);
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

const CARD = { kind: "item", uid: "cardAAAA1", part: "body" };
const key = (h, k, extra = {}) => h.ctl.handle({ type: "keydown", key: k, ...extra });

// ---------------------------------------------------------------- context menu
test("contextmenu: selects the hit item, reports its kind and consumes the event", () => {
  const h = harness();
  const cases = [
    [{ kind: "item", uid: "cardAAAA1", part: "body" }, "card"],
    [{ kind: "item", uid: "boardGGGG7", part: "body" }, "card"],
    [{ kind: "section-title", uid: "sectCCCC3" }, "section"],
    [{ kind: "section-border", uid: "sectCCCC3" }, "section"],
  ];
  for (const [target, kind] of cases) {
    assert.equal(h.ctl.handle(h.ev("contextmenu", { x: 5, y: 6 }, { target, button: 2 })), true);
    const m = h.named("openMenu").at(-1)[1];
    assert.equal(m.kind, kind);
    assert.equal(m.uid, target.uid);
    assert.deepEqual(m.selection, [target.uid]);
    assert.deepEqual(h.ctl.getSelection().items, [target.uid]);
  }
  const m = h.named("openMenu").at(-1)[1];
  assert.deepEqual(m.screen, { x: 5, y: 6 });
  assert.deepEqual(m.world, { x: 5, y: 6 });
});

test("contextmenu: text items, edges, links and empty canvas", () => {
  const h = harness();
  h.board.items.get("cardBBBB2").type = "text";
  h.ctl.handle(h.ev("contextmenu", { x: 0, y: 0 }, { target: { kind: "item", uid: "cardBBBB2", part: "body" } }));
  assert.equal(h.named("openMenu").at(-1)[1].kind, "text");
  h.ctl.handle(h.ev("contextmenu", { x: 0, y: 0 }, { target: { kind: "edge", uid: "edgeFFFF6" } }));
  assert.equal(h.named("openMenu").at(-1)[1].kind, "edge");
  assert.equal(h.ctl.getSelection().edge, "edgeFFFF6");
  assert.deepEqual(h.ctl.getSelection().items, []);
  h.ctl.handle(h.ev("contextmenu", { x: 0, y: 0 }, { target: { kind: "link", key: "k1" } }));
  assert.equal(h.named("openMenu").at(-1)[1].kind, "link");
  assert.equal(h.ctl.getSelection().link, "k1");
  h.ctl.select(["cardAAAA1"]);
  const sel = h.named("onSelection").length;
  h.ctl.handle(h.ev("contextmenu", { x: 900, y: 900 }));
  const m = h.named("openMenu").at(-1)[1];
  assert.equal(m.kind, "canvas");
  assert.equal(m.uid, null);
  assert.equal(h.named("onSelection").length, sel, "canvas menu leaves the selection alone");
});

test("contextmenu: a hit inside a multi-selection keeps it and reports 'multi'; outside it replaces it", () => {
  const h = harness();
  h.ctl.select(["cardAAAA1", "cardBBBB2"]);
  const sel = h.named("onSelection").length;
  h.ctl.handle(h.ev("contextmenu", { x: 0, y: 0 }, { target: CARD }));
  const m = h.named("openMenu").at(-1)[1];
  assert.equal(m.kind, "multi");
  assert.equal(m.uid, "cardAAAA1");
  assert.deepEqual(m.selection, ["cardAAAA1", "cardBBBB2"]);
  assert.equal(h.named("onSelection").length, sel, "selection untouched");
  h.ctl.handle(h.ev("contextmenu", { x: 0, y: 0 }, { target: { kind: "section-title", uid: "sectCCCC3" } }));
  assert.equal(h.named("openMenu").at(-1)[1].kind, "section");
  assert.deepEqual(h.ctl.getSelection().items, ["sectCCCC3"]);
});

test("contextmenu: chrome is not handled; pointerdown button 2 still does nothing", () => {
  const h = harness();
  assert.equal(h.ctl.handle(h.ev("contextmenu", { x: 0, y: 0 }, { target: { kind: "chrome" } })), false);
  assert.equal(h.named("openMenu").length, 0);
  h.ctl.handle(h.ev("pointerdown", { x: 10, y: 10 }, { target: CARD, button: 2 }));
  assert.equal(h.ctl.isGesturing(), false);
  assert.deepEqual(h.ctl.getSelection().items, []);
});

// ---------------------------------------------------------------- duplicate
test("alt-drag: ghosts preview, originals stay put, one duplicateItems on drop instead of commitMove", () => {
  const h = harness();
  h.ctl.handle(h.ev("pointerdown", { x: 10, y: 10 }, { target: CARD, alt: true }));
  assert.equal(h.ctl.gestureKind(), "move");
  h.ctl.handle(h.ev("pointermove", { x: 60, y: 30 }, { target: CARD, alt: true }));
  h.ctl.handle(h.ev("pointermove", { x: 110, y: 50 }, { target: CARD, alt: true }));
  assert.equal(h.named("previewMove").length, 0, "originals are not previewed");
  assert.deepEqual(h.named("showGhosts").at(-1)[1], [{ x: 100, y: 40, w: 200, h: 100 }]);
  h.ctl.handle(h.ev("pointerup", { x: 110, y: 50 }, { target: CARD, alt: true }));
  assert.equal(h.named("commitMove").length, 0);
  const dups = h.named("duplicateItems");
  assert.equal(dups.length, 1);
  assert.deepEqual(dups[0].slice(1), [["cardAAAA1"], { dx: 100, dy: 40, asRef: false }]);
  assert.equal(h.named("showGhosts").at(-1)[1], null, "ghosts cleared at the end");
  assert.deepEqual(h.ctl.getSelection().items, ["cardAAAA1"]);
});

test("shift-click only extends the selection and never opens an info tab (BUG-8); a shift-drag still moves", () => {
  const h = harness();
  const cardB = { kind: "item", uid: "cardBBBB2", part: "body" };
  h.ctl.handle(h.ev("pointerdown", { x: 10, y: 10 }, { target: CARD, shift: true }));
  h.ctl.handle(h.ev("pointerup", { x: 10, y: 10 }, { target: CARD, shift: true }));
  assert.equal(h.named("addInfoTab").length, 0);
  h.ctl.handle(h.ev("pointerdown", { x: 410, y: 10 }, { target: cardB }));
  h.ctl.handle(h.ev("pointerup", { x: 410, y: 10 }, { target: cardB }));
  assert.equal(h.named("addInfoTab").length, 0);
  h.ctl.handle(h.ev("pointerdown", { x: 10, y: 10 }, { target: CARD, shift: true }));
  h.ctl.handle(h.ev("pointermove", { x: 80, y: 40 }, { target: CARD, shift: true }));
  h.ctl.handle(h.ev("pointerup", { x: 80, y: 40 }, { target: CARD, shift: true }));
  assert.equal(h.named("addInfoTab").length, 0);
  assert.equal(h.named("commitMove").length, 1);
});

test("alt+shift drag duplicates as references; a selected item stays selected instead of toggling", () => {
  const h = harness();
  h.ctl.select(["cardAAAA1", "cardBBBB2"]);
  h.ctl.handle(h.ev("pointerdown", { x: 10, y: 10 }, { target: CARD, alt: true, shift: true }));
  h.ctl.handle(h.ev("pointermove", { x: 60, y: 60 }, { target: CARD, alt: true, shift: true }));
  assert.equal(h.named("showGhosts").at(-1)[1].length, 2);
  h.ctl.handle(h.ev("pointerup", { x: 60, y: 60 }, { target: CARD, alt: true, shift: true }));
  const d = h.named("duplicateItems")[0];
  assert.deepEqual(d[1], ["cardAAAA1", "cardBBBB2"]);
  assert.equal(d[2].asRef, true);
});

test("alt-click without movement behaves as a plain click; cancel clears ghosts without duplicating", () => {
  const h = harness();
  h.ctl.handle(h.ev("pointerdown", { x: 10, y: 10 }, { target: CARD, alt: true }));
  h.ctl.handle(h.ev("pointerup", { x: 11, y: 11 }, { target: CARD, alt: true }));
  assert.equal(h.named("duplicateItems").length, 0);
  assert.equal(h.named("commitMove").length, 0);
  assert.deepEqual(h.ctl.getSelection().items, ["cardAAAA1"]);
  h.ctl.handle(h.ev("pointerdown", { x: 10, y: 10 }, { target: CARD, alt: true }));
  h.ctl.handle(h.ev("pointermove", { x: 90, y: 90 }, { target: CARD, alt: true }));
  h.ctl.handle({ type: "pointercancel" });
  assert.equal(h.named("duplicateItems").length, 0);
  assert.equal(h.named("showGhosts").at(-1)[1], null);
  assert.equal(h.named("previewMove").length, 0);
});

test("alt-drag over a board card does not drop into it", () => {
  const h = harness();
  h.ctl.handle(h.ev("pointerdown", { x: 10, y: 10 }, { target: CARD, alt: true }));
  h.ctl.handle(h.ev("pointermove", { x: 1400, y: 500 }, { target: CARD, alt: true }));
  h.ctl.handle(h.ev("pointerup", { x: 1450, y: 520 }, { target: CARD, alt: true }));
  assert.equal(h.named("moveIntoBoard").length, 0);
  assert.equal(h.named("duplicateItems").length, 1);
});

test("Cmd/Ctrl+D duplicates the selection offset by 24; without a selection it is left to the browser", () => {
  const h = harness();
  assert.equal(key(h, "d", { meta: true }), false);
  h.ctl.select(["cardAAAA1", "cardBBBB2"]);
  assert.equal(key(h, "d", { meta: true }), true);
  assert.equal(key(h, "D", { ctrl: true }), true);
  const dups = h.named("duplicateItems");
  assert.equal(dups.length, 2);
  assert.deepEqual(dups[0].slice(1), [["cardAAAA1", "cardBBBB2"], { dx: 24, dy: 24, asRef: false }]);
});

// ---------------------------------------------------------------- keyboard
test("Alt+Arrow selects the nearest same-level object; Alt+Shift+Arrow adds it; plain arrows with no selection are not consumed", () => {
  const h = harness();
  assert.equal(key(h, "ArrowRight"), false);
  assert.equal(key(h, "ArrowRight", { alt: true }), false);
  h.ctl.select(["cardAAAA1"]);
  assert.equal(key(h, "ArrowRight", { alt: true }), true);
  assert.deepEqual(h.ctl.getSelection().items, ["cardBBBB2"]);
  assert.equal(h.named("commitMove").length, 0);
  key(h, "ArrowLeft", { alt: true });
  assert.deepEqual(h.ctl.getSelection().items, ["cardAAAA1"]);
  const sel = h.named("onSelection").length;
  key(h, "ArrowDown", { alt: true });
  assert.deepEqual(h.ctl.getSelection().items, ["sectCCCC3"], "the section, not the card nested inside it");
  assert.equal(h.named("onSelection").length, sel + 1, "one selection event per key");
  h.ctl.select(["cardAAAA1"]);
  key(h, "ArrowRight", { alt: true, shift: true });
  assert.deepEqual(h.ctl.getSelection().items, ["cardAAAA1", "cardBBBB2"]);
});

test("arrows inside a section only consider its members; an edge-only selection is not consumed", () => {
  const h = harness();
  h.ctl.select(["cardDDDD4"]);
  key(h, "ArrowRight", { alt: true });
  assert.deepEqual(h.ctl.getSelection().items, ["cardDDDD4"], "no sibling: selection stays");
  h.ctl.selectEdge("edgeFFFF6");
  assert.equal(key(h, "ArrowRight", { alt: true }), false);
  assert.equal(key(h, "ArrowRight"), false);
});

test("Arrow nudges 1px, Shift+Arrow 10px through commitMove", () => {
  const h = harness();
  h.ctl.select(["cardAAAA1"]);
  assert.equal(key(h, "ArrowDown"), true);
  assert.deepEqual(h.named("commitMove").at(-1).slice(1), [["cardAAAA1"], 0, 1]);
  key(h, "ArrowLeft", { shift: true });
  assert.deepEqual(h.named("commitMove").at(-1).slice(1), [["cardAAAA1"], -10, 0]);
  assert.deepEqual(h.ctl.getSelection().items, ["cardAAAA1"], "nudging never changes the selection");
});

test("Tab / Shift+Tab walk the outline order and wrap; Tab with no selection picks the first", () => {
  const h = harness();
  assert.equal(key(h, "Tab"), true);
  assert.deepEqual(h.ctl.getSelection().items, ["cardAAAA1"]);
  key(h, "Tab");
  assert.deepEqual(h.ctl.getSelection().items, ["cardBBBB2"]);
  key(h, "Tab");
  key(h, "Tab");
  assert.deepEqual(h.ctl.getSelection().items, ["cardDDDD4"], "section members follow their section");
  key(h, "Tab");
  key(h, "Tab");
  assert.deepEqual(h.ctl.getSelection().items, ["cardAAAA1"], "wraps to the start");
  key(h, "Tab", { shift: true });
  assert.deepEqual(h.ctl.getSelection().items, ["boardGGGG7"]);
  key(h, "Tab", { shift: true });
  assert.deepEqual(h.ctl.getSelection().items, ["cardDDDD4"]);
  const h2 = harness();
  key(h2, "Tab", { shift: true });
  assert.deepEqual(h2.ctl.getSelection().items, ["boardGGGG7"], "Shift+Tab with nothing selected starts from the end");
  assert.equal(key(h2, "Tab", { meta: true }), false, "browser tab switching is left alone");
});

test("Tab is left alone when the view reports focus is not on the board (tabOwned false)", () => {
  const h = harness();
  assert.equal(key(h, "Tab", { tabOwned: false }), false);
  assert.deepEqual(h.ctl.getSelection().items, []);
  assert.equal(key(h, "Tab", { tabOwned: true }), true);
  assert.deepEqual(h.ctl.getSelection().items, ["cardAAAA1"]);
});

test("dblclick on a section's bottom grip fits its contents; the corner grip still resets the size", () => {
  const h = harness();
  h.ctl.handle(h.ev("dblclick", { x: 200, y: 600 }, { target: { kind: "grip", uid: "sectCCCC3", part: "bottom" } }));
  assert.deepEqual(h.named("fitSection")[0].slice(1), ["sectCCCC3"]);
  assert.equal(h.named("fitHeight").length, 0, "no 'Zoom in to measure' path for a section");
  h.ctl.handle(h.ev("dblclick", { x: 400, y: 600 }, { target: { kind: "grip", uid: "sectCCCC3", part: "corner" } }));
  assert.deepEqual(h.named("resetSize")[0].slice(1), [["sectCCCC3"]]);
});

test("double-click and Enter open a card the view reports as a board shortcut, instead of editing it", () => {
  const h = harness({ extra: { isBoardCard: (uid) => uid === "cardBBBB2" } });
  h.ctl.handle(h.ev("dblclick", { x: 350, y: 50 }, { target: { kind: "item", uid: "cardBBBB2", part: "body" } }));
  assert.deepEqual(h.named("openBoard")[0].slice(1), ["cardBBBB2"]);
  assert.equal(h.named("enterEdit").length, 0);
  h.ctl.select(["cardBBBB2"]);
  key(h, "Enter");
  assert.equal(h.named("openBoard").length, 2);
  assert.equal(h.named("enterEdit").length, 0);
  h.ctl.select(["cardAAAA1"]);
  key(h, "Enter");
  assert.equal(h.named("enterEdit").length, 1, "an ordinary card still edits");
});

test("Cmd+Alt+Enter folds; F focus, Q quick look, P present; M expands only a single selected card", () => {
  const h = harness();
  h.ctl.select(["cardAAAA1"]);
  assert.equal(key(h, "Enter", { meta: true, alt: true }), true);
  assert.equal(h.named("foldSelection").length, 1);
  assert.equal(h.named("enterEdit").length, 0);
  assert.equal(key(h, "f"), true);
  assert.equal(key(h, "q"), true);
  assert.equal(key(h, "p"), true);
  assert.equal(h.named("toggleFocus").length, 1);
  assert.equal(h.named("quickLook").length, 1);
  assert.equal(h.named("present").length, 1);
  assert.equal(key(h, "m"), true);
  assert.deepEqual(h.named("expandOutline")[0].slice(1), ["cardAAAA1"]);
  h.ctl.select(["cardAAAA1", "cardBBBB2"]);
  assert.equal(key(h, "m"), false);
  h.ctl.select(["sectCCCC3"]);
  assert.equal(key(h, "m"), false);
  h.ctl.select([]);
  assert.equal(key(h, "m"), false);
  assert.equal(h.named("expandOutline").length, 1);
  assert.equal(h.ctl.getTool(), "select", "no tool key is bound to these letters");
});

test("Cmd/Ctrl+C, X and V are not consumed so the browser clipboard events still fire", () => {
  const h = harness();
  h.ctl.select(["cardAAAA1"]);
  for (const k of ["c", "x", "v"]) {
    assert.equal(key(h, k, { meta: true }), false);
    assert.equal(key(h, k, { ctrl: true }), false);
  }
  assert.equal(h.ctl.getTool(), "select", "Cmd+C is not the connect tool");
  assert.equal(h.named("deleteItems").length, 0);
});

test("present mode: paging keys take precedence over space-pan and arrow selection", () => {
  let active = true;
  const h = harness({ extra: { presentActive: () => active } });
  h.ctl.select(["cardAAAA1"]);
  for (const k of ["ArrowRight", "ArrowDown", "PageDown"]) assert.equal(key(h, k), true);
  assert.equal(key(h, " ", { code: "Space" }), true);
  assert.equal(h.named("presentNext").length, 4);
  for (const k of ["ArrowLeft", "ArrowUp", "PageUp"]) assert.equal(key(h, k), true);
  assert.equal(h.named("presentPrev").length, 3);
  assert.deepEqual(h.ctl.getSelection().items, ["cardAAAA1"], "arrows did not select");
  assert.equal(h.named("setSpace").length, 0, "space did not start a pan");
  active = false;
  key(h, " ", { code: "Space" });
  assert.equal(h.named("setSpace").length, 1);
  assert.equal(h.named("presentNext").length, 4);
  key(h, "ArrowRight", { alt: true });
  assert.deepEqual(h.ctl.getSelection().items, ["cardBBBB2"]);
});

test("Escape order: gesture, quick look, present, edit, focus, selection, popBoard, fullscreen", () => {
  const flags = { quick: true, present: true, focus: true, editing: false };
  let fullscreen = true;
  let pops = 1;
  let calls = [];
  const once = (name) => () => { calls.push(name); const was = flags[name]; flags[name] = false; return was; };
  const h = harness({
    extra: {
      closeQuickLook: once("quick"),
      exitPresent: once("present"),
      exitFocus: once("focus"),
      isEditing: () => flags.editing,
      editingUid: () => (flags.editing ? "cardAAAA1" : null),
      exitEdit: () => { calls.push("edit"); flags.editing = false; },
      isFullscreen: () => fullscreen,
      popBoard: () => { calls.push("pop"); return (pops -= 1) >= 0; },
      setFullscreen: () => { calls.push("fullscreen"); fullscreen = false; },
    },
  });
  h.ctl.select(["cardBBBB2"]);
  h.ctl.handle(h.ev("pointerdown", { x: 200, y: 50 }, { target: { kind: "port", uid: "cardBBBB2", side: "right" } }));
  flags.editing = true;
  const esc = () => { calls = []; return h.ctl.handle({ type: "keydown", key: "Escape" }); };
  assert.equal(esc(), true);
  assert.equal(h.ctl.isGesturing(), false);
  assert.deepEqual(calls, [], "the gesture ends first");
  esc();
  assert.deepEqual(calls, ["quick"]);
  esc();
  assert.deepEqual(calls, ["quick", "present"]);
  esc();
  assert.deepEqual(calls, ["quick", "present", "edit"]);
  esc();
  assert.deepEqual(calls, ["quick", "present", "focus"]);
  assert.deepEqual(h.ctl.getSelection().items, ["cardBBBB2"]);
  esc();
  assert.deepEqual(h.ctl.getSelection().items, [], "selection clears after focus");
  assert.deepEqual(calls, ["quick", "present", "focus"]);
  esc();
  assert.deepEqual(calls, ["quick", "present", "focus", "pop"]);
  esc();
  assert.deepEqual(calls, ["quick", "present", "focus", "pop", "fullscreen"], "fullscreen last, once the board cannot go up");
});

// ---------------------------------------------------------------- pinned
test("pinned: drag does nothing but still selects; mixed selections move only the unpinned items", () => {
  const h = harness();
  h.board.items.get("cardAAAA1").pinned = true;
  h.ctl.handle(h.ev("pointerdown", { x: 10, y: 10 }, { target: CARD }));
  h.ctl.handle(h.ev("pointermove", { x: 110, y: 50 }, { target: CARD }));
  h.ctl.handle(h.ev("pointerup", { x: 110, y: 50 }, { target: CARD }));
  assert.deepEqual(h.ctl.getSelection().items, ["cardAAAA1"]);
  assert.equal(h.named("previewMove").length, 0);
  assert.equal(h.named("commitMove").length, 0);
  h.ctl.select(["cardAAAA1", "cardBBBB2"]);
  h.ctl.handle(h.ev("pointerdown", { x: 410, y: 10 }, { target: { kind: "item", uid: "cardBBBB2", part: "body" } }));
  h.ctl.handle(h.ev("pointermove", { x: 460, y: 10 }, { target: { kind: "item", uid: "cardBBBB2", part: "body" } }));
  h.ctl.handle(h.ev("pointerup", { x: 460, y: 10 }, { target: { kind: "item", uid: "cardBBBB2", part: "body" } }));
  assert.deepEqual(h.named("commitMove").at(-1).slice(1), [["cardBBBB2"], 50, 0]);
});

test("pinned: arrow nudge and resize grips are ignored, marquee still selects, selecting works", () => {
  const h = harness();
  h.board.items.get("cardAAAA1").pinned = true;
  h.ctl.select(["cardAAAA1"]);
  key(h, "ArrowRight");
  assert.equal(h.named("commitMove").length, 0);
  h.ctl.select([]);
  const grip = { kind: "grip", uid: "cardAAAA1", part: "corner" };
  h.ctl.handle(h.ev("pointerdown", { x: 200, y: 100 }, { target: grip }));
  assert.equal(h.ctl.isGesturing(), false);
  assert.deepEqual(h.ctl.getSelection().items, []);
  h.ctl.handle(h.ev("pointermove", { x: 300, y: 300 }, { target: grip }));
  h.ctl.handle(h.ev("pointerup", { x: 300, y: 300 }, { target: grip }));
  assert.equal(h.named("commitRects").length, 0);
  h.ctl.handle(h.ev("pointerdown", { x: -50, y: -50 }));
  h.ctl.handle(h.ev("pointermove", { x: 700, y: 150 }));
  h.ctl.handle(h.ev("pointerup", { x: 700, y: 150 }));
  assert.deepEqual(h.ctl.getSelection().items.sort(), ["cardAAAA1", "cardBBBB2"]);
});

test("pinned: Delete keeps pinned items and toasts; an all-pinned selection deletes nothing", async () => {
  const h = harness();
  h.board.items.get("cardAAAA1").pinned = true;
  h.ctl.select(["cardAAAA1", "cardBBBB2"]);
  assert.equal(key(h, "Delete"), true);
  await Promise.resolve();
  assert.deepEqual(h.named("deleteItems")[0].slice(1), [["cardBBBB2"], { withContents: false }]);
  assert.ok(h.named("toast").some((c) => c[1].message === "Pinned items were not deleted. Unpin first."));
  assert.equal(h.named("toast").at(-1)[1].message, "Deleted", "the Undo toast is the last one");
  assert.deepEqual(h.ctl.getSelection().items, ["cardAAAA1"], "the pinned item stays selected");
  h.ctl.select(["cardAAAA1"]);
  key(h, "Backspace");
  assert.equal(h.named("deleteItems").length, 1, "nothing more deleted");
  assert.equal(h.named("toast").at(-1)[1].message, "Pinned items were not deleted. Unpin first.");
  h.ctl.select(["sectCCCC3"]);
  h.board.items.get("cardDDDD4").pinned = true;
  key(h, "Delete", { shift: true });
  assert.equal(h.named("deleteItems").length, 1, "a section holding a pinned member is not deleted with its contents");
  key(h, "Delete");
  assert.equal(h.named("deleteItems").length, 2, "without contents the section itself can go");
});

test("pinned items can still be duplicated", () => {
  const h = harness();
  h.board.items.get("cardAAAA1").pinned = true;
  h.ctl.handle(h.ev("pointerdown", { x: 10, y: 10 }, { target: CARD, alt: true }));
  h.ctl.handle(h.ev("pointermove", { x: 110, y: 50 }, { target: CARD, alt: true }));
  h.ctl.handle(h.ev("pointerup", { x: 110, y: 50 }, { target: CARD, alt: true }));
  assert.deepEqual(h.named("duplicateItems")[0][1], ["cardAAAA1"]);
});

// ---------------------------------------------------------------- fit gestures and previews
test("dblclick on the bottom connection port (it covers the bottom grip's center) fits like the grip; other ports do nothing", () => {
  const h = harness();
  h.ctl.handle(h.ev("dblclick", { x: 100, y: 100 }, { target: { kind: "port", uid: "cardAAAA1", side: "bottom" } }));
  assert.deepEqual(h.named("fitHeight")[0].slice(1), ["cardAAAA1"]);
  h.ctl.handle(h.ev("dblclick", { x: 200, y: 50 }, { target: { kind: "port", uid: "cardAAAA1", side: "right" } }));
  assert.equal(h.named("fitHeight").length, 1);
  assert.equal(h.named("createCard").length, 0);
  h.ctl.handle(h.ev("dblclick", { x: 200, y: 600 }, { target: { kind: "port", uid: "sectCCCC3", side: "bottom" } }));
  assert.deepEqual(h.named("fitSection")[0].slice(1), ["sectCCCC3"]);
});

test("dblclick: bottom grip fits height, corner grip resets size, right grip does nothing", () => {
  const h = harness();
  h.ctl.handle(h.ev("dblclick", { x: 100, y: 100 }, { target: { kind: "grip", uid: "cardAAAA1", part: "bottom" } }));
  assert.deepEqual(h.named("fitHeight")[0].slice(1), ["cardAAAA1"]);
  h.ctl.handle(h.ev("dblclick", { x: 200, y: 100 }, { target: { kind: "grip", uid: "cardAAAA1", part: "corner" } }));
  assert.deepEqual(h.named("resetSize")[0].slice(1), [["cardAAAA1"]]);
  h.ctl.handle(h.ev("dblclick", { x: 200, y: 50 }, { target: { kind: "grip", uid: "cardAAAA1", part: "right" } }));
  assert.equal(h.named("fitHeight").length, 1);
  assert.equal(h.named("resetSize").length, 1);
  assert.equal(h.named("createCard").length, 0);
  assert.equal(h.named("enterEdit").length, 0);
});

test("cancelPreview runs at every gesture end and on pointercancel", () => {
  const h = harness();
  h.ctl.handle(h.ev("pointerdown", { x: 10, y: 10 }, { target: CARD }));
  h.ctl.handle(h.ev("pointermove", { x: 110, y: 50 }, { target: CARD }));
  assert.equal(h.named("cancelPreview").length, 0);
  h.ctl.handle(h.ev("pointerup", { x: 110, y: 50 }, { target: CARD }));
  assert.equal(h.named("cancelPreview").length, 1);
  assert.equal(h.named("showGhosts").at(-1)[1], null);
  const grip = { kind: "grip", uid: "cardAAAA1", part: "corner" };
  h.ctl.handle(h.ev("pointerdown", { x: 200, y: 100 }, { target: grip }));
  h.ctl.handle(h.ev("pointermove", { x: 300, y: 200 }, { target: grip }));
  h.ctl.handle({ type: "pointercancel" });
  assert.equal(h.named("cancelPreview").length, 2);
  assert.deepEqual(h.named("previewRects").at(-1)[1], []);
});

test("UI-3: each palette tool places or switches", async () => {
  const place = async (key) => {
    const h = harness();
    h.ctl.handle({ type: "keydown", key });
    h.ctl.handle(h.ev("pointerdown", { x: 400, y: 300 }));
    h.ctl.handle(h.ev("pointerup", { x: 400, y: 300 }));
    await tick();
    return h;
  };
  const sticky = await place("s");
  assert.equal(sticky.named("createText")[0][1].look, "sticky");
  assert.equal(sticky.named("createText")[0][1].w, 200);
  assert.equal(sticky.named("createCard").length, 0);
  const shape = await place("r");
  assert.equal(shape.named("createText")[0][1].shape, "rectangle");
  assert.equal(shape.named("createText")[0][1].w, 160);
  const card = await place("n");
  assert.equal(card.named("createCard").length, 1);
  const text = await place("t");
  assert.equal(text.named("createText")[0][1].look, undefined);
  assert.equal(text.named("createText")[0][1].shape, undefined);
  const section = await place("g");
  assert.equal(section.named("createSection").length, 1);
  const board = await place("w");
  assert.equal(board.named("createBoard").length, 1);
  const connect = harness();
  connect.ctl.handle({ type: "keydown", key: "c" });
  assert.equal(connect.ctl.getTool(), "connect");
  assert.equal(connect.named("addEdge").length, 0);
  const hand = harness();
  hand.ctl.handle({ type: "keydown", key: "h" });
  hand.ctl.handle(hand.ev("pointerdown", { x: 10, y: 10 }));
  hand.ctl.handle(hand.ev("pointermove", { x: 40, y: 30 }));
  hand.ctl.handle(hand.ev("pointerup", { x: 40, y: 30 }));
  assert.equal(hand.ctl.getTool(), "hand");
  assert.equal(hand.named("createCard").length, 0);
  assert.equal(hand.named("createText").length, 0);
  assert.ok(hand.named("setViewport").length > 0);
  const select = harness();
  select.ctl.setTool("hand");
  select.ctl.handle({ type: "keydown", key: "v" });
  assert.equal(select.ctl.getTool(), "select");
});

test("UI-8: every shortcut in the sheet runs from that same table", () => {
  for (const row of SHORTCUTS) {
    for (const event of row.events) {
      assert.equal(findShortcut(event, row.mode || "normal"), row, row.keys);
    }
  }
  const needsCard = new Set(["nudge", "nearest", "duplicate", "wrap", "delete", "enter", "outline", "expand", "escape", "fitSelection"]);
  for (const row of SHORTCUTS) {
    if (row.mode === "view") continue;
    const h = harness({
      settings: row.tool === "task" ? { "task-tool": true } : {},
      extra: row.mode === "present" ? { presentActive: () => true } : {},
    });
    if (row.action === "zoomReset") h.ctl.handle({ type: "keydown", key: "=", meta: true });
    for (const event of row.events) {
      if (needsCard.has(row.action)) h.ctl.select(["cardAAAA1"]);
      if (row.action === "renamePage") h.ctl.select(["cardBBBB2"]);
      const handled = h.ctl.handle({ type: "keydown", ...event });
      assert.equal(handled, true, `${row.keys} ${event.key}`);
      if (row.action === "tool") assert.equal(h.ctl.getTool(), row.tool);
      if (row.action === "nearest" && event.key === "ArrowRight") assert.ok(h.ctl.getSelection().items.includes("cardBBBB2"));
      if (row.action === "nudge") {
        const step = event.shift ? 10 : 1;
        const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
        const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
        assert.deepEqual(h.named("commitMove").at(-1).slice(1), [["cardAAAA1"], dx, dy]);
      }
      if (row.action === "delete") {
        const opts = h.named("deleteItems").at(-1)[2];
        assert.equal(Boolean(opts.withContents), Boolean(event.shift));
      }
    }
    if (row.action === "search") assert.equal(h.named("openSearch").length, row.events.length);
    if (row.action === "undo") assert.equal(h.named("undo").length, 1);
    if (row.action === "redo") assert.equal(h.named("redo").length, 1);
    if (row.action === "zoomIn") assert.ok(h.vp.zoom > 1);
    if (row.action === "zoomOut") assert.ok(h.vp.zoom < 1);
    if (row.action === "zoomReset") assert.ok(Math.abs(h.vp.zoom - 1) < 1e-9);
    if (row.action === "fitAll") assert.equal(h.named("fitAll").length, 1);
    if (row.action === "fitSelection") assert.equal(h.named("fitSelection").length, 1);
    if (row.action === "links") assert.equal(h.named("cycleLinks").length, 1);
    if (row.action === "info") assert.equal(h.named("openInfo").length, row.events.length);
    if (row.action === "focus") assert.equal(h.named("toggleFocus").length, 1);
    if (row.action === "quickLook") assert.equal(h.named("quickLook").length, 1);
    if (row.action === "present") assert.equal(h.named("present").length, 1);
    if (row.action === "help") assert.equal(h.named("toggleShortcuts").length, 1);
    if (row.action === "duplicate") assert.equal(h.named("duplicateItems").length, 1);
    if (row.action === "wrap") assert.equal(h.named("wrapInSection").length, 1);
    if (row.action === "fold") assert.equal(h.named("foldSelection").length, 1);
    if (row.action === "back") assert.equal(h.named("historyBack").length, 1);
    if (row.action === "forward") assert.equal(h.named("historyForward").length, 1);
    if (row.action === "selectAll") assert.ok(h.ctl.getSelection().items.length > 1);
    if (row.action === "renamePage") assert.deepEqual(h.named("renamePage").at(-1)[1], "cardBBBB2");
    if (row.action === "enter") assert.deepEqual(h.named("enterEdit").at(-1)[1], "cardAAAA1");
    if (row.action === "expand") assert.deepEqual(h.named("expandOutline").at(-1)[1], "cardAAAA1");
    if (row.action === "space") assert.deepEqual(h.named("setSpace").at(-1)[1], true);
    if (row.action === "escape") assert.deepEqual(h.ctl.getSelection().items, []);
    if (row.action === "outline") assert.notDeepEqual(h.ctl.getSelection().items, ["cardAAAA1"]);
    if (row.action === "presentNext") {
      assert.equal(h.named("presentNext").length, row.events.length);
      assert.equal(h.named("setSpace").length, 0);
    }
    if (row.action === "presentPrev") assert.equal(h.named("presentPrev").length, row.events.length);
  }
});

test("BUG-6 / PL-10: the Escape that closed an overlay or search never also leaves fullscreen", () => {
  let overlay = true;
  let recent = false;
  let fullscreen = true;
  const h = harness({
    extra: {
      closeOverlay: () => { const was = overlay; overlay = false; if (was) recent = true; return was; },
      overlayEscapeRecent: () => recent,
      isFullscreen: () => fullscreen,
      setFullscreen: () => { fullscreen = false; },
    },
  });
  const esc = () => h.ctl.handle({ type: "keydown", key: "Escape" });
  assert.equal(esc(), true, "first Escape closes the overlay");
  assert.equal(fullscreen, true);
  assert.equal(esc(), true, "an Escape right after a closed overlay is swallowed");
  assert.equal(fullscreen, true, "fullscreen stays");
  recent = false;
  esc();
  assert.equal(fullscreen, false, "a later Escape with nothing open leaves fullscreen");
});

test("BUG-8 / PL-12: shift-click extends the selection and opens no panel", () => {
  const h = harness();
  const cardB = { kind: "item", uid: "cardBBBB2", part: "body" };
  h.ctl.handle(h.ev("pointerdown", { x: 10, y: 10 }, { target: CARD }));
  h.ctl.handle(h.ev("pointerup", { x: 10, y: 10 }, { target: CARD }));
  h.ctl.handle(h.ev("pointerdown", { x: 410, y: 10 }, { target: cardB, shift: true }));
  h.ctl.handle(h.ev("pointerup", { x: 410, y: 10 }, { target: cardB, shift: true }));
  assert.deepEqual(h.ctl.getSelection().items.slice().sort(), ["cardAAAA1", "cardBBBB2"]);
  assert.equal(h.named("addInfoTab").length, 0);
  assert.equal(h.named("openInfo").length, 0);
});

// ------------------------------------------------------------------ RF-5 hand-tool resize
test("RF-5: with the Hand tool a press on a resize grip resizes instead of panning", () => {
  const h = harness();
  h.ctl.setTool("hand");
  const grip = { kind: "grip", uid: "cardAAAA1", part: "corner" };
  h.ctl.handle(h.ev("pointerdown", { x: 200, y: 100 }, { target: grip }));
  assert.equal(h.ctl.gestureKind(), "resize");
  h.ctl.handle(h.ev("pointermove", { x: 260, y: 150 }, { target: grip }));
  h.ctl.handle(h.ev("pointerup", { x: 260, y: 150 }, { target: grip }));
  const commits = h.named("commitRects");
  assert.equal(commits.length, 1, "one resize commit");
  assert.equal(h.ctl.getTool(), "hand", "the Hand tool stays active");
  assert.equal(h.named("setViewport").length, 0, "nothing panned");
});

test("RF-5: with the Hand tool anything that is not a grip still pans, and Space or the middle button pan over a grip", () => {
  const h = harness();
  h.ctl.setTool("hand");
  h.ctl.handle(h.ev("pointerdown", { x: 50, y: 50 }, { target: { kind: "item", uid: "cardAAAA1", part: "body" } }));
  assert.equal(h.ctl.gestureKind(), "pan");
  h.ctl.handle(h.ev("pointerup", { x: 50, y: 50 }));
  const grip = { kind: "grip", uid: "cardAAAA1", part: "corner" };
  h.ctl.handle(h.ev("pointerdown", { x: 200, y: 100 }, { target: grip, button: 1 }));
  assert.equal(h.ctl.gestureKind(), "pan", "middle button pans");
  h.ctl.handle(h.ev("pointerup", { x: 200, y: 100 }, { button: 1 }));
  h.ctl.handle({ type: "keydown", key: " ", code: "Space", meta: false, ctrl: false, shift: false, alt: false });
  h.ctl.handle(h.ev("pointerdown", { x: 200, y: 100 }, { target: grip }));
  assert.equal(h.ctl.gestureKind(), "pan", "Space pans");
});
