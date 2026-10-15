// UX lane B: Shift+Enter child, Roam outline, focus crumb, hover peek.
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { kidsHeightPlan, peekAllowed, rememberUnfoldedSize, findBlock, childIsOpen, PEEK_HOVER_MS, PEEK_LEAVE_MS } from "../src/model/card-children.js";
import { editorKeyAction } from "../src/view/editor-keys.js";
import { createItemRenderer } from "../src/view/cards.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import "../src/session-clip.js";

afterEach(() => resetSessions());

const at = (over) => editorKeyAction({ key: "Enter", isRoot: true, value: "Note", selectionStart: 4, selectionEnd: 4, ...over });

test("Shift+Enter on a card's top block makes a child; a nested block keeps Roam's Shift+Enter", () => {
  assert.equal(at({ shift: true }).type, "make-child");
  assert.equal(at({ shift: true, isRoot: false }).type, "roam");
  assert.equal(at({ shift: true, autocomplete: true }).type, "roam");
  assert.equal(at({ shift: true, meta: true }).type, "roam");
  assert.equal(at({ shift: true, alt: true }).type, "roam");
  assert.equal(at().type, "newline");
});

test("kids height grows on unfold and returns to the stored folded height", () => {
  const opened = kidsHeightPlan({ on: true, h: 100, extraH: 80 });
  assert.equal(opened.h, 180);
  assert.equal(opened.memory.foldedH, 100);
  const closed = kidsHeightPlan({ on: false, h: opened.h, memory: opened.memory });
  assert.equal(closed.h, 100);
  const resized = rememberUnfoldedSize(opened.memory, 240);
  assert.equal(resized.foldedH, 100);
  assert.equal(resized.userSized, true);
  const again = kidsHeightPlan({ on: true, h: 100, extraH: 80, memory: resized });
  assert.equal(again.h, 240, "the resize is the unfolded size only");
  assert.equal(kidsHeightPlan({ on: false, h: 240, memory: again.memory }).h, 100);
});

test("peek waits for detail tier and a block or page card that is not already open", () => {
  const base = { tier: "detail", kind: "block", childCount: 2, showing: false };
  assert.equal(peekAllowed(base), true);
  assert.equal(peekAllowed({ ...base, tier: "overview" }), false);
  assert.equal(peekAllowed({ ...base, tier: "map" }), false);
  assert.equal(peekAllowed({ ...base, gesturing: true }), false);
  assert.equal(peekAllowed({ ...base, kind: "note" }), false);
  assert.equal(peekAllowed({ ...base, kind: "page" }), true);
  assert.equal(peekAllowed({ ...base, showing: true }), false);
  assert.equal(peekAllowed({ ...base, editing: true }), false);
  assert.equal(peekAllowed({ ...base, childCount: 0 }), false);
  assert.equal(PEEK_HOVER_MS, 800);
  assert.equal(PEEK_LEAVE_MS, 400);
});

test("findBlock walks nested children and childIsOpen reads Roam's fold", () => {
  const tree = [{ uid: "a", string: "A", children: [{ uid: "b", string: "B", ":block/open": false, children: [{ uid: "c", string: "C" }] }] }];
  const read = {
    uid: (n) => n.uid,
    kids: (n) => n.children || [],
    label: (n) => n.string,
  };
  const hit = findBlock(tree, "b", read);
  assert.equal(hit.block.uid, "b");
  assert.deepEqual(hit.trail.map((t) => t.uid), ["a", "b"]);
  assert.equal(childIsOpen(hit.block), false);
  assert.equal(childIsOpen(tree[0]), true);
  assert.equal(findBlock(tree, "missing", read), null);
});

const card = (uid, string, x, y, w = 240, h = 100, extra = {}, children = []) => ({
  uid, string, props: { plexus: { x, y, w, h, ...extra } }, children,
});
function setup(children) {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({ uid: "b1", props: { plexus: { v: 2 } }, children });
  const session = acquireSession("b1", { host, settings: null, linkDelay: 0 });
  fake.clearLog();
  return { fake, host, session };
}

test("addCardChild creates one child, unfolds, and one undo removes both", async () => {
  const { fake, session } = setup([card("X", "note", 10, 20, 240, 100, { color: "teal" })]);
  const child = await session.addCardChild("X");
  assert.equal(typeof child, "string");
  assert.equal(fake.block(child).string, "");
  assert.equal(fake.block(child).parent, "X");
  assert.equal(fake.props("X").plexus.kids, true);
  assert.ok(fake.props("X").plexus.h > 100);
  assert.equal(fake.props("X").plexus.color, "teal");
  await session.undo();
  assert.equal(fake.block(child), null);
  assert.equal("kids" in (fake.props("X").plexus || {}), false);
  assert.equal(fake.props("X").plexus.h, 100);
});

test("setKids restores the folded height, and a resize while open is the unfolded size only", async () => {
  const { fake, session } = setup([card("X", "note", 10, 20, 240, 100, { color: "teal" }, [{ uid: "c000", string: "kid" }])]);
  await session.setKids("X", true, 80);
  assert.equal(fake.props("X").plexus.h, 180);
  await session.commitRects([{ uid: "X", x: 10, y: 20, w: 240, h: 260 }]);
  await session.setKids("X", false);
  assert.equal(fake.props("X").plexus.h, 100);
  assert.equal("kids" in fake.props("X").plexus, false);
  await session.setKids("X", true, 80);
  assert.equal(fake.props("X").plexus.h, 260);
});

test("setNodeOpen writes :block/open and one undo puts it back", async () => {
  const { fake, session } = setup([card("X", "note", 10, 20, 240, 100, { kids: true }, [{ uid: "c000", string: "kid", children: [{ uid: "g000", string: "grand" }] }])]);
  assert.equal(await session.setNodeOpen("c000", false), true);
  assert.equal(fake.block("c000").open, false);
  await session.undo();
  assert.equal(fake.block("c000").open, true);
});

const blk = (uid, string, plexus, order, children = [], open) => ({
  ":block/uid": uid,
  ":block/string": string,
  ":block/order": order,
  ":block/props": plexus ? { ":plexus": plexus } : {},
  ":block/children": children,
  ...(open === false ? { ":block/open": false } : {}),
});
const rawBoard = (children) => ({
  ":block/uid": "board0001",
  ":block/string": "{{[[diagram]]:Test}}",
  ":block/props": { ":plexus": { ":v": 2 } },
  ":block/children": children,
});
const visible = { x: -10000, y: -10000, w: 20000, h: 20000 };

function harness({ children, hostOverrides = {}, session = {} } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const host = {
    renderString(node, string) { node.textContent = string; },
    unmount() {},
    blockString: () => null,
    pullTree: () => [],
    pullBoard: () => null,
    pagePreview: () => ({ exists: false, blocks: [] }),
    ...hostOverrides,
  };
  const root = doc.createElement("div");
  root.className = "pxd-root";
  doc.body.append(root);
  const sectionsLayer = doc.createElement("div");
  const itemsLayer = doc.createElement("div");
  root.append(sectionsLayer);
  root.append(itemsLayer);
  const idleQueue = [];
  const laterQueue = [];
  const timers = {
    idle(fn) { idleQueue.push(fn); return () => { const i = idleQueue.indexOf(fn); if (i >= 0) idleQueue.splice(i, 1); }; },
    later(fn, ms) { const t = { fn, ms }; laterQueue.push(t); return () => { const i = laterQueue.indexOf(t); if (i >= 0) laterQueue.splice(i, 1); }; },
  };
  const writes = [];
  const sess = {
    setKids: (...args) => { writes.push(["setKids", ...args]); return Promise.resolve(); },
    setNodeOpen: (...args) => { writes.push(["setNodeOpen", ...args]); return Promise.resolve(true); },
    ...session,
  };
  const r = createItemRenderer({ doc, host, session: sess, itemsLayer, sectionsLayer, timers });
  let board = null;
  const load = (raw) => {
    board = buildBoard(raw);
    r.sync({ board, rects: worldRects(board), dirty: null, structural: true });
    return board;
  };
  load(rawBoard(children));
  const flush = () => {
    let guard = 0;
    while (idleQueue.length && guard++ < 50) idleQueue.shift()({ timeRemaining: () => 10, didTimeout: false });
  };
  const show = () => {
    r.setLod("detail", 1);
    r.scheduleContent({ visibleRect: visible, zoom: 1, tier: "detail" });
    flush();
  };
  const fire = (ms) => {
    for (const t of [...laterQueue].filter((x) => x.ms === ms)) {
      laterQueue.splice(laterQueue.indexOf(t), 1);
      t.fn();
    }
  };
  return { stub, restore, doc, root, r, writes, load, show, laterQueue, fire, itemsLayer, host };
}

const alpha = [
  blk("kidA00001", "child one", null, 0, [blk("kidA10001", "grandchild", null, 0)]),
  blk("kidB00001", "child two", null, 1),
];

test("an open card draws a Roam outline: bullet, indent, and a caret that writes :block/open", (t) => {
  const folded = [blk("kidA00001", "child one", null, 0, [blk("kidA10001", "grandchild", null, 0)], false)];
  const h = harness({ children: [blk("noteAAAA1", "alpha", { ":x": 0, ":y": 0, ":w": 240, ":h": 100, ":kids": true }, 0, folded)] });
  t.after(h.restore);
  h.show();
  const cardEl = h.root.querySelector("[data-uid=noteAAAA1]");
  const rows = [...cardEl.querySelectorAll(".pxd-block")];
  assert.equal(rows.length, 1, "a folded child hides its grandchild");
  assert.ok(rows[0].querySelector(".pxd-outline__bullet"));
  const caret = rows[0].querySelector(".pxd-outline__caret");
  assert.equal(caret.getAttribute("aria-expanded"), "false");
  caret.click();
  assert.deepEqual(h.writes[0], ["setNodeOpen", "kidA00001", true]);
  assert.equal(cardEl.querySelectorAll(".pxd-block").length, 2, "the caret opens the nested row locally");
});

test("a bullet click focuses that block with a crumb and writes nothing; dispose clears it", (t) => {
  const h = harness({ children: [blk("noteAAAA1", "alpha", { ":x": 0, ":y": 0, ":w": 240, ":h": 100, ":kids": true }, 0, alpha)] });
  t.after(h.restore);
  h.show();
  const cardEl = h.root.querySelector("[data-uid=noteAAAA1]");
  const bullet = cardEl.querySelector("[data-pxd-row=kidA00001] .pxd-outline__bullet");
  bullet.click();
  assert.equal(h.writes.length, 0);
  const crumb = cardEl.querySelector(".pxd-focus__crumb");
  assert.ok(crumb);
  assert.match(crumb.textContent, /alpha/);
  assert.match(crumb.textContent, /child one/);
  assert.equal(cardEl.querySelector("[data-pxd-row=kidB00001]"), null, "siblings are hidden while focused");
  assert.ok(cardEl.querySelector("[data-pxd-row=kidA10001]"));
  crumb.querySelector("[data-pxd-focus=card]").click();
  assert.ok(cardEl.querySelector("[data-pxd-row=kidB00001]"));
  cardEl.querySelector("[data-pxd-row=kidA00001] .pxd-outline__bullet").click();
  h.r.dispose();
  const h2 = harness({ children: [blk("noteAAAA1", "alpha", { ":x": 0, ":y": 0, ":w": 240, ":h": 100, ":kids": true }, 0, alpha)] });
  t.after(h2.restore);
  h2.show();
  assert.equal(h2.root.querySelector(".pxd-focus__crumb"), null);
});

test("hovering a block-ref card peeks its children without a write, and overview never arms", (t) => {
  const tree = [{ uid: "rk1000001", string: "ref kid", children: [] }, { uid: "rk2000001", string: "ref kid 2", children: [] }];
  const h = harness({
    children: [blk("refAAAA01", "((target001))", { ":x": 0, ":y": 0, ":w": 240, ":h": 100 }, 0)],
    hostOverrides: { blockString: () => "target text", pullTree: () => tree },
  });
  t.after(h.restore);
  h.show();
  const cardEl = h.root.querySelector("[data-uid=refAAAA01]");
  h.stub.dispatch(cardEl, "mouseenter", { buttons: 0 });
  assert.equal(cardEl.querySelector(".pxd-link-peek"), null);
  assert.ok(h.laterQueue.some((x) => x.ms === PEEK_HOVER_MS));
  h.fire(PEEK_HOVER_MS);
  const peek = cardEl.querySelector(".pxd-link-peek");
  assert.ok(peek);
  assert.equal(peek.querySelectorAll(".pxd-block").length, 2);
  assert.equal(h.writes.length, 0, "peek does not write :block/open or kids");
  h.stub.dispatch(cardEl, "mouseleave");
  assert.ok(h.laterQueue.some((x) => x.ms === PEEK_LEAVE_MS));
  h.fire(PEEK_LEAVE_MS);
  assert.equal(cardEl.querySelector(".pxd-link-peek"), null);
  h.r.setLod("overview", 0.2);
  h.stub.dispatch(cardEl, "mouseenter", { buttons: 0 });
  assert.equal(h.laterQueue.some((x) => x.ms === PEEK_HOVER_MS), false);
});
