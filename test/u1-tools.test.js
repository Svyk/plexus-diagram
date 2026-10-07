// U1: Hand moves items, and Select/Connect drag on empty space pans unless Shift or empty-drag is "select".

import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { createSettingsPanel, normalizeSetting, settingsDefaults } from "../src/settings.js";
import { createInteractions } from "../src/view/interactions.js";
import { TIP_TEXT } from "../src/view/tooltip-text.js";

const PAN_LINE = "Drag empty space to pan; Shift-drag to select.";
const WRITES = ["commitMove", "commitRects", "createCard", "createText", "createSection", "createBoard", "addEdge", "deleteItems", "deleteEdges", "duplicateItems", "moveIntoBoard", "wrapInSection"];

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
      { ...item("edgesEEE5", "Connections", { ":type": "edges" }, [
        item("edgeFFFF6", "((cardAAAA1)) → [[Beta]]", { ":type": "edge", ":from": "cardAAAA1", ":to": "cardBBBB2" }),
      ]), ":block/order": 3 },
    ],
  };
}

function harness({ vp = { x: 0, y: 0, zoom: 1 }, settings = {} } = {}) {
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
    createText: rec("createText"),
    createSection: rec("createSection"),
    createBoard: rec("createBoard"),
    addEdge: rec("addEdge"),
    deleteItems: rec("deleteItems"),
    deleteEdges: rec("deleteEdges"),
    duplicateItems: rec("duplicateItems"),
    moveIntoBoard: rec("moveIntoBoard"),
    wrapInSection: rec("wrapInSection"),
    enterEdit: rec("enterEdit"),
    exitEdit: rec("exitEdit"),
    isEditing: () => false,
    editingUid: () => null,
    cancelPreview: rec("cancelPreview"),
    showGhosts: rec("showGhosts"),
    setSpace: rec("setSpace"),
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
  return { ctl, named, ev, writes: () => WRITES.reduce((n, name) => n + named(name).length, 0) };
}

const CARD = { kind: "item", uid: "cardAAAA1", part: "body" };
const drag = (h, from, to, extra = {}) => {
  h.ctl.handle(h.ev("pointerdown", from, extra));
  h.ctl.handle(h.ev("pointermove", to, extra));
  h.ctl.handle(h.ev("pointerup", to, extra));
};

test("hand drag on an item is a move and one write", () => {
  const h = harness({ settings: { "snap-guides": false } });
  h.ctl.setTool("hand");
  h.ctl.handle(h.ev("pointerdown", { x: 10, y: 10 }, { target: CARD }));
  assert.equal(h.ctl.gestureKind(), "move");
  assert.equal(h.ctl.getTool(), "hand");
  h.ctl.handle(h.ev("pointermove", { x: 60, y: 10 }, { target: CARD }));
  h.ctl.handle(h.ev("pointerup", { x: 60, y: 10 }, { target: CARD }));
  assert.equal(h.ctl.getTool(), "hand", "the Hand tool stays on");
  assert.equal(h.named("commitMove").length, 1);
  assert.deepEqual(h.named("commitMove")[0].slice(1), [["cardAAAA1"], 50, 0]);
  assert.equal(h.named("setViewport").length, 0);
  assert.equal(h.writes(), 1);
});

test("hand drag moves a multi-selection in one write, and snap guides still draw", () => {
  const exact = harness({ settings: { "snap-guides": false } });
  exact.ctl.setTool("hand");
  exact.ctl.select(["cardAAAA1", "cardBBBB2"]);
  const cardB = { kind: "item", uid: "cardBBBB2", part: "body" };
  exact.ctl.handle(exact.ev("pointerdown", { x: 410, y: 10 }, { target: cardB }));
  exact.ctl.handle(exact.ev("pointermove", { x: 450, y: 10 }, { target: cardB }));
  exact.ctl.handle(exact.ev("pointerup", { x: 450, y: 10 }, { target: cardB }));
  assert.equal(exact.named("commitMove").length, 1);
  assert.deepEqual(exact.named("commitMove")[0][1].slice().sort(), ["cardAAAA1", "cardBBBB2"]);
  assert.deepEqual(exact.named("commitMove")[0].slice(2), [40, 0]);
  assert.equal(exact.writes(), 1);

  const h = harness();
  h.ctl.setTool("hand");
  h.ctl.handle(h.ev("pointerdown", { x: 10, y: 10 }, { target: CARD }));
  h.ctl.handle(h.ev("pointermove", { x: 60, y: 10 }, { target: CARD }));
  assert.equal(h.named("showGuides").some((c) => Array.isArray(c[1]) && c[1].length > 0), true);
  h.ctl.handle(h.ev("pointerup", { x: 60, y: 10 }, { target: CARD }));
});

test("hand drag on a section title or border moves that section", () => {
  const h = harness({ settings: { "snap-guides": false } });
  h.ctl.setTool("hand");
  const title = { kind: "section-title", uid: "sectCCCC3" };
  h.ctl.handle(h.ev("pointerdown", { x: 40, y: 310 }, { target: title }));
  assert.equal(h.ctl.gestureKind(), "move");
  h.ctl.handle(h.ev("pointermove", { x: 80, y: 330 }, { target: title }));
  h.ctl.handle(h.ev("pointerup", { x: 80, y: 330 }, { target: title }));
  assert.deepEqual(h.named("commitMove")[0].slice(1), [["sectCCCC3"], 40, 20]);
  const border = { kind: "section-border", uid: "sectCCCC3" };
  h.ctl.handle(h.ev("pointerdown", { x: 10, y: 400 }, { target: border }));
  h.ctl.handle(h.ev("pointermove", { x: 30, y: 400 }, { target: border }));
  h.ctl.handle(h.ev("pointerup", { x: 30, y: 400 }, { target: border }));
  assert.deepEqual(h.named("commitMove")[1].slice(1), [["sectCCCC3"], 20, 0]);
  assert.equal(h.writes(), 2);
  assert.equal(h.named("setViewport").length, 0);
});

test("hand click on an item selects it and writes nothing", () => {
  const h = harness();
  h.ctl.setTool("hand");
  h.ctl.handle(h.ev("pointerdown", { x: 10, y: 10 }, { target: CARD }));
  h.ctl.handle(h.ev("pointerup", { x: 10, y: 10 }, { target: CARD }));
  assert.deepEqual(h.ctl.getSelection().items, ["cardAAAA1"]);
  assert.equal(h.named("commitMove").length, 0);
  assert.equal(h.named("setViewport").length, 0);
  assert.equal(h.writes(), 0);
  assert.equal(h.ctl.getTool(), "hand");
});

test("hand drag on empty space pans and writes nothing", () => {
  const h = harness();
  h.ctl.setTool("hand");
  h.ctl.select(["cardBBBB2"]);
  h.ctl.handle(h.ev("pointerdown", { x: 2000, y: 2000 }));
  assert.equal(h.ctl.gestureKind(), "pan");
  h.ctl.handle(h.ev("pointermove", { x: 2080, y: 2060 }));
  h.ctl.handle(h.ev("pointerup", { x: 2080, y: 2060 }));
  assert.equal(h.named("setViewport").length, 1);
  assert.deepEqual(h.named("setViewport")[0][1], { x: 80, y: 60, zoom: 1 });
  assert.deepEqual(h.ctl.getSelection().items, ["cardBBBB2"], "a pan does not clear the selection");
  assert.equal(h.writes(), 0);
  assert.equal(h.ctl.getTool(), "hand");
});

test("hand shift-drag on empty space draws the marquee and keeps what was selected", () => {
  const h = harness();
  h.ctl.setTool("hand");
  h.ctl.select(["cardDDDD4"]);
  drag(h, { x: -50, y: -50 }, { x: 250, y: 150 }, { shift: true });
  const items = h.ctl.getSelection().items;
  assert.ok(items.includes("cardAAAA1"));
  assert.ok(items.includes("cardDDDD4"));
  assert.equal(items.includes("cardBBBB2"), false);
  assert.equal(h.named("showMarquee").some((c) => c[1] && c[2] === "select"), true);
  assert.equal(h.named("setViewport").length, 0);
  assert.equal(h.writes(), 0);
  assert.equal(h.ctl.getTool(), "hand");
});

test("hand press on a resize grip still resizes", () => {
  const h = harness();
  h.ctl.setTool("hand");
  const grip = { kind: "grip", uid: "cardAAAA1", part: "corner" };
  h.ctl.handle(h.ev("pointerdown", { x: 200, y: 100 }, { target: grip }));
  assert.equal(h.ctl.gestureKind(), "resize");
  h.ctl.handle(h.ev("pointermove", { x: 260, y: 140 }, { target: grip }));
  h.ctl.handle(h.ev("pointerup", { x: 260, y: 140 }, { target: grip }));
  assert.equal(h.named("commitRects").length, 1);
  assert.equal(h.named("setViewport").length, 0);
  assert.equal(h.ctl.getTool(), "hand");
});

test("select drag on empty space pans and the tool stays select", () => {
  const h = harness();
  h.ctl.select(["cardDDDD4"]);
  h.ctl.handle(h.ev("pointerdown", { x: -100, y: -100 }));
  assert.equal(h.ctl.gestureKind(), "pan");
  assert.equal(h.ctl.getTool(), "select");
  h.ctl.handle(h.ev("pointermove", { x: 100, y: 40 }));
  h.ctl.handle(h.ev("pointerup", { x: 100, y: 40 }));
  assert.equal(h.named("setViewport").length, 1);
  assert.equal(h.named("showMarquee").some((c) => c[1] && c[2] === "select"), false);
  assert.deepEqual(h.ctl.getSelection().items, ["cardDDDD4"]);
  assert.equal(h.writes(), 0);
  assert.equal(h.ctl.getTool(), "select");
});

test("select shift-drag on empty space draws the marquee and keeps the selection", () => {
  const h = harness();
  h.ctl.select(["cardDDDD4"]);
  drag(h, { x: -50, y: -50 }, { x: 250, y: 150 }, { shift: true });
  const items = h.ctl.getSelection().items;
  assert.ok(items.includes("cardAAAA1"));
  assert.ok(items.includes("cardDDDD4"));
  assert.equal(items.includes("cardBBBB2"), false);
  assert.equal(h.named("showMarquee").some((c) => c[1] && c[2] === "select"), true);
  assert.equal(h.named("setViewport").length, 0);
  assert.equal(h.writes(), 0);
});

test("select alt-drag on empty space lassos", () => {
  const h = harness();
  h.ctl.handle(h.ev("pointerdown", { x: -30, y: 50 }, { alt: true }));
  h.ctl.handle(h.ev("pointermove", { x: 230, y: -30 }, { alt: true }));
  h.ctl.handle(h.ev("pointermove", { x: 100, y: 120 }, { alt: true }));
  h.ctl.handle(h.ev("pointerup", { x: 100, y: 120 }, { alt: true }));
  assert.deepEqual(h.ctl.getSelection().items, ["cardAAAA1"]);
  assert.equal(h.named("showLasso").some((c) => Array.isArray(c[1]) && c[1].length >= 3), true);
  assert.equal(h.named("setViewport").length, 0);
  assert.equal(h.writes(), 0);
});

test("connect drag on empty space pans, and a drag from an item connects", () => {
  const h = harness();
  h.ctl.setTool("connect");
  h.ctl.handle(h.ev("pointerdown", { x: 2000, y: 2000 }));
  assert.equal(h.ctl.gestureKind(), "pan");
  h.ctl.handle(h.ev("pointermove", { x: 2060, y: 2040 }));
  h.ctl.handle(h.ev("pointerup", { x: 2060, y: 2040 }));
  assert.equal(h.ctl.getTool(), "connect");
  assert.equal(h.named("setViewport").length, 1);
  assert.equal(h.named("addEdge").length, 0);
  assert.equal(h.writes(), 0);

  h.ctl.handle(h.ev("pointerdown", { x: 100, y: 40 }, { target: CARD }));
  assert.equal(h.ctl.gestureKind(), "connect");
  assert.equal(h.ctl.getTool(), "connect");
  assert.equal(h.named("showTempWire").some((c) => c[1]?.from === "cardAAAA1"), true);
  assert.equal(h.named("commitMove").length, 0);
});

test("empty-drag select restores the marquee for Select and Connect", () => {
  const h = harness({ settings: { "empty-drag": "select" } });
  drag(h, { x: -50, y: -50 }, { x: 700, y: 150 });
  assert.deepEqual(h.ctl.getSelection().items.sort(), ["cardAAAA1", "cardBBBB2"]);
  assert.equal(h.named("showMarquee").some((c) => c[1] && c[2] === "select"), true);
  assert.equal(h.named("setViewport").length, 0);
  assert.equal(h.writes(), 0);
  assert.equal(h.ctl.getTool(), "select");

  h.ctl.setTool("connect");
  h.ctl.handle(h.ev("pointerdown", { x: 2000, y: 2000 }));
  h.ctl.handle(h.ev("pointermove", { x: 2200, y: 2200 }));
  assert.equal(h.ctl.gestureKind(), "marquee");
  h.ctl.handle(h.ev("pointerup", { x: 2200, y: 2200 }));
  assert.equal(h.named("setViewport").length, 0);
  assert.equal(h.ctl.getTool(), "connect");

  h.ctl.setTool("hand");
  h.ctl.handle(h.ev("pointerdown", { x: 1800, y: 1800 }));
  h.ctl.handle(h.ev("pointermove", { x: 1860, y: 1840 }));
  assert.equal(h.ctl.gestureKind(), "pan", "Hand still pans on empty space");
  h.ctl.handle(h.ev("pointerup", { x: 1860, y: 1840 }));
  assert.equal(h.named("setViewport").length, 1);
});

test("a click on empty space clears the selection and does not pan", () => {
  const h = harness();
  h.ctl.select(["cardAAAA1"]);
  h.ctl.handle(h.ev("pointerdown", { x: 2000, y: 2000 }));
  h.ctl.handle(h.ev("pointerup", { x: 2000, y: 2000 }));
  assert.deepEqual(h.ctl.getSelection().items, []);
  assert.equal(h.ctl.getSelection().edge, null);
  assert.equal(h.named("setViewport").length, 0);
  assert.equal(h.writes(), 0);

  h.ctl.selectEdge("edgeFFFF6");
  h.ctl.handle(h.ev("pointerdown", { x: 1800, y: 1800 }));
  h.ctl.handle(h.ev("pointerup", { x: 1800, y: 1800 }));
  assert.equal(h.ctl.getSelection().edge, null);
  assert.deepEqual(h.ctl.getSelection().items, []);
});

test("space-drag and the middle button still pan, including over an item", () => {
  const h = harness();
  h.ctl.handle({ type: "keydown", key: " ", code: "Space" });
  h.ctl.handle(h.ev("pointerdown", { x: 10, y: 10 }, { target: CARD }));
  assert.equal(h.ctl.gestureKind(), "pan");
  h.ctl.handle(h.ev("pointermove", { x: 40, y: 30 }, { target: CARD }));
  h.ctl.handle(h.ev("pointerup", { x: 40, y: 30 }, { target: CARD }));
  h.ctl.handle({ type: "keyup", key: " ", code: "Space" });
  assert.equal(h.named("setViewport").length, 1);
  assert.equal(h.named("commitMove").length, 0);

  h.ctl.setTool("hand");
  h.ctl.handle(h.ev("pointerdown", { x: 10, y: 10 }, { target: CARD, button: 1 }));
  assert.equal(h.ctl.gestureKind(), "pan");
  h.ctl.handle(h.ev("pointerup", { x: 10, y: 10 }, { button: 1 }));
  assert.equal(h.writes(), 0);
});

test("a creation tool drag on empty space still places instead of panning", () => {
  const h = harness();
  h.ctl.setTool("card");
  h.ctl.handle(h.ev("pointerdown", { x: 1500, y: 1500 }));
  assert.equal(h.ctl.gestureKind(), "place");
  h.ctl.handle(h.ev("pointermove", { x: 1600, y: 1600 }));
  h.ctl.handle(h.ev("pointerup", { x: 1600, y: 1600 }));
  assert.equal(h.named("setViewport").length, 0);
  assert.equal(h.named("commitMove").length, 0);
  h.ctl.setTool("section");
  h.ctl.handle(h.ev("pointerdown", { x: 900, y: 900 }));
  assert.equal(h.ctl.gestureKind(), "section-draw");
  h.ctl.handle(h.ev("pointerup", { x: 900, y: 900 }));
});

test("double-click still edits an item under the Hand tool", () => {
  const h = harness();
  h.ctl.setTool("hand");
  h.ctl.handle(h.ev("dblclick", { x: 10, y: 10 }, { target: CARD }));
  assert.deepEqual(h.named("enterEdit").at(-1)[1], "cardAAAA1");
  assert.equal(h.named("setViewport").length, 0);
  assert.equal(h.ctl.getTool(), "hand");
});

test("empty-drag defaults to pan and the panel calls it Drag on empty canvas", () => {
  assert.equal(settingsDefaults()["empty-drag"], "pan");
  assert.equal(normalizeSetting("empty-drag", "select"), "select");
  assert.equal(normalizeSetting("empty-drag", "nope"), "pan");
  assert.equal(normalizeSetting("empty-drag", null), "pan");
  const row = createSettingsPanel().settings.find((entry) => entry.id === "empty-drag");
  assert.equal(row.name, "Drag on empty canvas");
  assert.equal(row.action.type, "select");
  assert.deepEqual(row.action.items, ["pan", "select"]);
  const ids = createSettingsPanel().settings.map((entry) => entry.id);
  assert.ok(ids.indexOf("empty-drag") > ids.indexOf("group-board"));
  assert.ok(ids.indexOf("empty-drag") < ids.indexOf("group-performance"));
  for (const id of ["tool.select", "tool.hand", "tool.connect"]) {
    assert.equal(TIP_TEXT[id].desc.includes(PAN_LINE), true, id);
  }
});
