// ECO-4 wire. Exercises buildBoard, createDrawing, and the card renderer.
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { DRAWING_DROP_TOAST, droppedDrawingUids } from "../src/model/drawing-card.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { createItemRenderer } from "../src/view/cards.js";
import { buildMenu } from "../src/view/menu-model.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const MACRO = "{{[[excalidraw]]}}";
const DRAW = "draw0001";

afterEach(() => {
  resetSessions();
  delete globalThis.RoamPlexus;
});

function raw(children) {
  return {
    ":block/uid": "boardA",
    ":block/string": "{{[[diagram]]:Lab}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": children,
  };
}

function child(uid, string, order, extra = {}) {
  return {
    ":block/uid": uid,
    ":block/string": string,
    ":block/order": order,
    ":block/props": extra.props || {},
    ":block/children": extra.children || [],
  };
}

test("a drawing macro is not a board item, and a ref to one is a drawing card", () => {
  const board = buildBoard(raw([
    child("bare", MACRO, 0),
    child("ref1", `((${DRAW}))`, 1, { props: { ":plexus": { ":x": 10, ":y": 20 } } }),
    child("sec", "Group", 2, {
      props: { ":plexus": { ":type": "section", ":x": 0, ":y": 40, ":w": 400, ":h": 300 } },
      children: [child("nested", `${MACRO} note`, 0)],
    }),
  ]), {
    defaults: { card: { w: 280, h: 160 } },
    resolve: (uid) => (uid === DRAW ? MACRO : "plain"),
  });
  assert.equal(board.items.has("bare"), false);
  assert.equal(board.items.has("nested"), false);
  const card = board.items.get("ref1");
  assert.equal(card.kind, "drawing-ref");
  assert.equal(card.title, "Drawing");
  assert.deepEqual(card.target, { kind: "block", uid: DRAW });
});

test("dropped drawing uids are named and the toast stays a reference", () => {
  const ids = droppedDrawingUids([`((${DRAW}))`, "((note1))", "[[Page]]"], (uid) => (uid === DRAW ? MACRO : "hello"));
  assert.deepEqual(ids, [DRAW]);
  assert.equal(DRAWING_DROP_TOAST, "Drawings stay where they are; this is a reference");
});

test("the canvas menu lists New drawing here after New board", () => {
  const ids = buildMenu("canvas", {}).filter((item) => item.id).map((item) => item.id);
  const boardAt = ids.indexOf("new-board");
  assert.equal(ids[boardAt + 1], "new-drawing");
});

test("createDrawing with Roam Plexus writes the macro once and props only on the ref", async () => {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({ uid: "b1", props: { plexus: { v: 2 } }, children: [] });
  const calls = [];
  globalThis.RoamPlexus = {
    apiVersion: 7,
    create(args) {
      calls.push(args);
      return fake.api.data.block.create({
        location: { "parent-uid": args.parentUid, order: args.order },
        block: { uid: DRAW, string: MACRO },
      }).then(() => ({ uid: DRAW, pageUid: null }));
    },
  };
  const session = acquireSession("b1", { host, linkDelay: 0 });
  fake.clearLog();
  const ref = await session.createDrawing({ x: 40, y: 40 });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { parentUid: "b1", order: "last" });
  const drawing = fake.block(DRAW);
  assert.equal(drawing.string, MACRO);
  assert.deepEqual(drawing.props, {});
  const card = fake.block(ref);
  assert.equal(card.string, `((${DRAW}))`);
  assert.ok(card.props.plexus);
  assert.equal(session.board.items.has(DRAW), false);
  assert.equal(session.board.items.get(ref).kind, "drawing-ref");
});

test("createDrawing without Roam Plexus still writes a bare macro and a ref card", async () => {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({ uid: "b1", props: { plexus: { v: 2 } }, children: [] });
  const session = acquireSession("b1", { host, linkDelay: 0 });
  const ref = await session.createDrawing({ x: 12, y: 16 });
  const kids = fake.children("b1").map((uid) => fake.block(uid));
  const drawing = kids.find((block) => block.string === MACRO);
  const card = fake.block(ref);
  assert.ok(drawing);
  assert.deepEqual(drawing.props, {});
  assert.equal(card.string, `((${drawing.uid}))`);
  assert.ok(card.props.plexus);
  assert.equal(session.board.items.has(drawing.uid), false);
  assert.equal(session.board.items.get(ref).kind, "drawing-ref");
});

test("a drawing card opens the drawing, lists regions, and does not enter edit", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  const opens = [];
  const added = [];
  const renders = [];
  globalThis.RoamPlexus = {
    apiVersion: 7,
    thumbnail(uid, opts) {
      opens.push(["thumb", uid, opts]);
      return "data:image/png;base64,abc";
    },
    regionsOf() {
      return [{ uid: "reg1", kind: "area", caption: "Region A" }];
    },
    open(uid, opts) { opens.push(["open", uid, opts]); },
  };
  try {
    const doc = stub.document;
    const itemsLayer = doc.createElement("div");
    const sectionsLayer = doc.createElement("div");
    doc.body.append(itemsLayer, sectionsLayer);
    const idleQueue = [];
    const r = createItemRenderer({
      doc,
      host: {
        renderString(node, string) { node.textContent = string; },
        renderBlock(_el, uid) { renders.push(uid); },
        unmount() {},
        blockString: () => MACRO,
        pullTree: () => [],
      },
      session: { addPublicCard(op) { added.push(op); } },
      itemsLayer,
      sectionsLayer,
      timers: {
        idle(fn) { idleQueue.push(fn); return () => {}; },
        later(fn) { return () => {}; },
      },
    });
    const board = buildBoard(raw([
      child("ref1", `((${DRAW}))`, 0, { props: { ":plexus": { ":x": 10, ":y": 20, ":w": 280, ":h": 160 } } }),
    ]), { resolve: () => MACRO });
    r.sync({ board, rects: worldRects(board), structural: true });
    r.setLod("detail", 1);
    r.scheduleContent({ visibleRect: { x: -1000, y: -1000, w: 4000, h: 4000 }, zoom: 1, tier: "detail" });
    while (idleQueue.length) idleQueue.shift()({ timeRemaining: () => 10, didTimeout: false });
    await Promise.resolve();
    await Promise.resolve();
    const shell = r.shellOf("ref1");
    assert.equal(shell.classList.contains("pxd-item--drawing"), true);
    const img = shell.querySelector("img.pxd-drawing-thumb");
    assert.equal(img.src, "data:image/png;base64,abc");
    assert.deepEqual(opens[0], ["thumb", DRAW, { maxWidth: 160 }]);
    const row = shell.querySelector(".pxd-drawing-region");
    assert.equal(row.textContent, "Region A");
    row.dispatchEvent({ type: "click" });
    assert.deepEqual(added, [{ string: "((reg1))" }]);
    shell.querySelector(".pxd-drawing-open").dispatchEvent({ type: "click" });
    assert.deepEqual(opens.at(-1), ["open", DRAW, { sidebar: false }]);
    const held = doc.createElement("div");
    held.setAttribute("id", `block-input-win-body-outline-page00001-${DRAW}`);
    // The stub's selector engine has no [id^=...]; answer that one query from the body like a browser does.
    const query = doc.querySelectorAll.bind(doc);
    doc.querySelectorAll = (sel) => (sel === '[id^="block-input-"]'
      ? Array.from(doc.body.children).filter((node) => String(node.id || node.getAttribute?.("id") || "").startsWith("block-input-"))
      : query(sel));
    const editor = doc.createElement("div");
    editor.className = "excalidraw";
    held.append(editor);
    doc.body.append(held);
    const before = opens.length;
    shell.querySelector(".pxd-drawing-open").dispatchEvent({ type: "click" });
    assert.equal(opens.length, before);
    assert.equal(await r.enterEdit("ref1"), false);
    assert.deepEqual(renders, []);
    r.dispose();
  } finally {
    restore();
  }
});
