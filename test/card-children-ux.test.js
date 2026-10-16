// UX lane B: Shift+Enter child, Roam outline, focus crumb, hover peek.
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { buildBoard, diffBoards, worldRects } from "../src/model/board.js";
import { kidsHeightPlan, peekAllowed, rememberUnfoldedSize, findBlock, childIsOpen, focusStep, cardOwningBlock, cardOwningByParent, focusOpenBlock, PEEK_HOVER_MS, PEEK_LEAVE_MS } from "../src/model/card-children.js";
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

test("a resize while folded replaces the stored folded height", () => {
  const opened = kidsHeightPlan({ on: true, h: 100, extraH: 80 });
  const closed = kidsHeightPlan({ on: false, h: opened.h, memory: opened.memory });
  const again = kidsHeightPlan({ on: true, h: 140, extraH: 80, memory: closed.memory });
  assert.equal(again.memory.foldedH, 140);
  assert.equal(kidsHeightPlan({ on: false, h: again.h, memory: again.memory }).h, 140);
  const shorter = rememberUnfoldedSize(closed.memory, 80);
  const grown = kidsHeightPlan({ on: true, h: 140, extraH: 80, memory: shorter });
  assert.equal(grown.h, 220, "an unfolded size shorter than the new folded height does not shrink the card");
  assert.equal(kidsHeightPlan({ on: false, h: grown.h, memory: grown.memory }).h, 140);
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
function setup(children, { echoDelay = 5, raf, trackUndo = false, graceMs } = {}) {
  const fake = createFakeRoam({ echoDelay });
  if (trackUndo) fake.trackUndo = true;
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({ uid: "b1", props: { plexus: { v: 2 } }, children });
  const session = acquireSession("b1", {
    host, settings: null, linkDelay: 0,
    ...(raf ? { raf } : {}),
    ...(graceMs != null ? { graceMs } : {}),
  });
  fake.clearLog();
  return { fake, host, session };
}

test("Shift+Enter on a block card parents the child on the referenced block", async () => {
  const { fake, session } = setup(
    [card("X", "((target01))", 10, 20, 240, 100, { color: "teal" })],
    { trackUndo: true },
  );
  fake.seedPage({ title: "Target", uid: "pgtarget", children: [{ uid: "target01", string: "the block" }] });
  const child = await session.addCardChild("X");
  assert.equal(fake.block(child).parent, "target01");
  assert.equal(fake.props("X").plexus.kids, true);
  assert.ok(fake.props("X").plexus.h > 100);
  await session.undo();
  assert.equal(fake.block(child), null);
  assert.equal(fake.props("X").plexus.h, 100);
});

test("Shift+Enter keeps an earlier move on the undo stack", async () => {
  const { fake, session } = setup(
    [card("X", "note", 10, 20, 240, 100)],
    { echoDelay: 0, raf: (fn) => fn(), trackUndo: true },
  );
  await session.commitRects([{ uid: "X", x: 50, y: 20, w: 240, h: 100 }]);
  const child = await session.addCardChild("X");
  await session.undo();
  assert.equal(fake.block(child), null);
  assert.equal(fake.props("X").plexus.h, 100);
  assert.equal(fake.props("X").plexus.x, 50);
  await session.undo();
  assert.equal(fake.props("X").plexus.x, 10);
});

test("addCardChild creates one child, unfolds, and one undo removes both", async () => {
  const { fake, session } = setup(
    [card("X", "note", 10, 20, 240, 100, { color: "teal" })],
    { trackUndo: true },
  );
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

test("a folded resize, including one card of a multi-select, is what the next refold restores", async () => {
  const { fake, session } = setup([
    card("X", "note", 10, 20, 240, 100, {}, [{ uid: "c000", string: "kid" }]),
    card("Y", "other", 300, 20, 240, 100, {}, [{ uid: "c001", string: "kid" }]),
  ]);
  await session.setKids("X", true, 80);
  await session.setKids("X", false);
  await session.commitRects([{ uid: "X", x: 10, y: 20, w: 240, h: 140 }]);
  await session.setKids("X", true, 80);
  await session.setKids("X", false);
  assert.equal(fake.props("X").plexus.h, 140);

  await session.setKids("Y", true, 80);
  await session.setKids("Y", false);
  await session.commitRects([
    { uid: "X", x: 10, y: 20, w: 240, h: 140 },
    { uid: "Y", x: 300, y: 20, w: 240, h: 160 },
  ]);
  await session.setKids("X", true, 80);
  await session.setKids("Y", true, 80);
  await session.setKids("X", false);
  await session.setKids("Y", false);
  assert.equal(fake.props("X").plexus.h, 140);
  assert.equal(fake.props("Y").plexus.h, 160);
});

test("a remote height change while folded replaces the stored folded height", async () => {
  const { fake, host, session } = setup(
    [card("X", "note", 10, 20, 240, 100, {}, [{ uid: "c000", string: "kid" }])],
    { echoDelay: 0, raf: (fn) => fn(), graceMs: 0 },
  );
  await session.setKids("X", true, 80);
  await session.setKids("X", false);
  await fake.flush();
  await host.updateProps("X", { ...fake.props("X").plexus, h: 150 });
  await fake.flush();
  assert.equal(session.board.items.get("X").h, 150);
  await session.setKids("X", true, 80);
  await session.setKids("X", false);
  assert.equal(fake.props("X").plexus.h, 150);
});

test("undo of a resize while open forgets that height", async () => {
  const { fake, session } = setup(
    [card("X", "note", 10, 20, 240, 100, {}, [{ uid: "c000", string: "kid" }])],
    { echoDelay: 0, raf: (fn) => fn(), trackUndo: true },
  );
  await session.setKids("X", true, 80);
  await session.commitRects([{ uid: "X", x: 10, y: 20, w: 240, h: 260 }]);
  await session.undo();
  await fake.flush();
  assert.equal(fake.props("X").plexus.h, 180);
  await session.setKids("X", false);
  assert.equal(fake.props("X").plexus.h, 100);
  await session.setKids("X", true, 80);
  assert.equal(fake.props("X").plexus.h, 180);
});

test("a remote height change while open is what the next unfold uses", async () => {
  const { fake, host, session } = setup(
    [card("X", "note", 10, 20, 240, 100, {}, [{ uid: "c000", string: "kid" }])],
    { echoDelay: 0, raf: (fn) => fn(), graceMs: 0 },
  );
  await session.setKids("X", true, 80);
  await fake.flush();
  await host.updateProps("X", { ...fake.props("X").plexus, h: 300 });
  await fake.flush();
  assert.equal(session.board.items.get("X").h, 300);
  await session.setKids("X", false);
  assert.equal(fake.props("X").plexus.h, 100);
  await session.setKids("X", true, 80);
  assert.equal(fake.props("X").plexus.h, 300);
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
  const { fake, session } = setup(
    [card("X", "note", 10, 20, 240, 100, { kids: true }, [{ uid: "c000", string: "kid", children: [{ uid: "g000", string: "grand" }] }])],
    { trackUndo: true },
  );
  assert.equal(await session.setNodeOpen("c000", false), true);
  assert.equal(fake.block("c000").open, false);
  await session.undo();
  assert.equal(fake.block("c000").open, true);
});

test("folding a block-ref child writes :block/open and keeps an earlier resize", async () => {
  const { fake, session } = setup(
    [card("X", "((target01))", 10, 20, 240, 100, { kids: true })],
    { echoDelay: 0, raf: (fn) => fn(), trackUndo: true },
  );
  fake.seedPage({
    title: "Target",
    uid: "pgtarget",
    children: [{ uid: "target01", string: "the block", children: [{ uid: "ck000001", string: "kid" }] }],
  });
  await session.commitRects([{ uid: "X", x: 10, y: 20, w: 240, h: 140 }]);
  assert.equal(await session.setNodeOpen("ck000001", false, "X"), true);
  assert.equal(fake.block("ck000001").open, false);
  await session.undo();
  assert.equal(fake.block("ck000001").open, true);
  assert.equal(fake.props("X").plexus.h, 140);
  await session.undo();
  assert.equal(fake.props("X").plexus.h, 100);
});

test("folding a child keeps an earlier resize on the undo stack", async () => {
  const { fake, session } = setup(
    [card("X", "note", 10, 20, 240, 100, { kids: true }, [{ uid: "c000", string: "kid", children: [{ uid: "g000", string: "grand" }] }])],
    { echoDelay: 0, raf: (fn) => fn(), trackUndo: true },
  );
  await session.commitRects([{ uid: "X", x: 10, y: 20, w: 240, h: 140 }]);
  assert.equal(await session.setNodeOpen("c000", false), true);
  assert.equal(fake.block("c000").open, false);
  await session.undo();
  assert.equal(fake.block("c000").open, true);
  assert.equal(fake.props("X").plexus.h, 140);
  await session.undo();
  assert.equal(fake.props("X").plexus.h, 100);
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

test("a block-ref outline follows outlineRev after the pulled fold changes", (t) => {
  let folded = false;
  const h = harness({
    children: [blk("refAAAA01", "((target01))", { ":x": 0, ":y": 0, ":w": 240, ":h": 160, ":kids": true }, 0)],
    hostOverrides: {
      blockString: () => "target text",
      pullTree: () => [{ uid: "ck000001", string: "kid", open: !folded, children: [{ uid: "gk000001", string: "grand" }] }],
    },
  });
  t.after(h.restore);
  h.show();
  const cardEl = h.root.querySelector("[data-uid=refAAAA01]");
  assert.equal(cardEl.querySelector(".pxd-outline__caret").getAttribute("aria-expanded"), "true");
  folded = true;
  const next = buildBoard(rawBoard([blk("refAAAA01", "((target01))", { ":x": 0, ":y": 0, ":w": 240, ":h": 160, ":kids": true }, 0)]));
  next.items.get("refAAAA01").outlineRev = 1;
  h.r.sync({ board: next, rects: worldRects(next), dirty: new Set(["refAAAA01"]), structural: false });
  h.show();
  assert.equal(cardEl.querySelector(".pxd-outline__caret").getAttribute("aria-expanded"), "false");
  assert.equal(cardEl.querySelectorAll(".pxd-block").length, 1);
});

test("a child fold dirties the card and the caret follows without a local click", (t) => {
  const openKids = [blk("kidA00001", "child one", null, 0, [blk("kidA10001", "grandchild", null, 0)])];
  const closedKids = [blk("kidA00001", "child one", null, 0, [blk("kidA10001", "grandchild", null, 0)], false)];
  const renamed = [blk("kidA00001", "renamed", null, 0, [blk("kidA10001", "grandchild", null, 0)])];
  const cardOf = (kids) => blk("noteAAAA1", "alpha", { ":x": 0, ":y": 0, ":w": 240, ":h": 100, ":kids": true }, 0, kids);
  const prev = buildBoard(rawBoard([cardOf(openKids)]));
  const folded = buildBoard(rawBoard([cardOf(closedKids)]));
  const edited = buildBoard(rawBoard([cardOf(renamed)]));
  const fold = diffBoards(prev, folded);
  assert.equal(fold.structural, false);
  assert.equal(fold.dirty.has("noteAAAA1"), true);
  assert.equal(diffBoards(prev, edited).dirty.has("noteAAAA1"), false, "a child string edit stays out of the layout diff");
  const h = harness({ children: [cardOf(openKids)] });
  t.after(h.restore);
  h.show();
  const cardEl = h.root.querySelector("[data-uid=noteAAAA1]");
  assert.equal(cardEl.querySelector(".pxd-outline__caret").getAttribute("aria-expanded"), "true");
  h.r.sync({ board: folded, rects: worldRects(folded), dirty: fold.dirty, structural: false });
  h.show();
  const caret = cardEl.querySelector(".pxd-outline__caret");
  assert.equal(caret.getAttribute("aria-expanded"), "false");
  assert.equal(cardEl.querySelectorAll(".pxd-block").length, 1);
});

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
  assert.deepEqual(h.writes[0], ["setNodeOpen", "kidA00001", true, "noteAAAA1"]);
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

test("overview hover does not pull the linked block", (t) => {
  const tree = [{ uid: "rk1000001", string: "ref kid", children: [] }];
  let pulls = 0;
  const h = harness({
    children: [blk("refAAAA01", "((target001))", { ":x": 0, ":y": 0, ":w": 240, ":h": 100 }, 0)],
    hostOverrides: {
      blockString: () => "target text",
      pullTree: () => { pulls += 1; return tree; },
    },
  });
  t.after(h.restore);
  h.show();
  const cardEl = h.root.querySelector("[data-uid=refAAAA01]");
  h.r.setLod("overview", 0.2);
  pulls = 0;
  h.stub.dispatch(cardEl, "mouseenter", { buttons: 0 });
  assert.equal(pulls, 0);
  assert.equal(h.laterQueue.some((x) => x.ms === PEEK_HOVER_MS), false);
});

test("a peek promised after the pointer left does not open", async (t) => {
  const tree = [{ uid: "rk1000001", string: "ref kid", children: [] }];
  let resolvePull = null;
  let pending = null;
  const h = harness({
    children: [blk("refAAAA01", "((target001))", { ":x": 0, ":y": 0, ":w": 240, ":h": 100 }, 0)],
    hostOverrides: {
      blockString: () => "target text",
      pullTree: (_uid, depth) => {
        if (depth > 1) {
          pending = new Promise((resolve) => { resolvePull = resolve; });
          return pending;
        }
        return tree;
      },
    },
  });
  t.after(h.restore);
  h.show();
  const cardEl = h.root.querySelector("[data-uid=refAAAA01]");
  h.stub.dispatch(cardEl, "mouseenter", { buttons: 0 });
  h.fire(PEEK_HOVER_MS);
  assert.equal(typeof resolvePull, "function");
  h.stub.dispatch(cardEl, "mouseleave");
  resolvePull(tree);
  await pending;
  assert.equal(Boolean(cardEl.querySelector(".pxd-link-peek")), false);
});

test("removing a card cancels a hover peek that has not opened", (t) => {
  const tree = [{ uid: "rk1000001", string: "ref kid", children: [] }];
  const h = harness({
    children: [blk("refAAAA01", "((target001))", { ":x": 0, ":y": 0, ":w": 240, ":h": 100 }, 0)],
    hostOverrides: { blockString: () => "target text", pullTree: () => tree },
  });
  t.after(h.restore);
  h.show();
  const cardEl = h.root.querySelector("[data-uid=refAAAA01]");
  h.stub.dispatch(cardEl, "mouseenter", { buttons: 0 });
  assert.ok(h.laterQueue.some((x) => x.ms === PEEK_HOVER_MS));
  h.load(rawBoard([]));
  assert.equal(h.laterQueue.some((x) => x.ms === PEEK_HOVER_MS), false);
});

test("closing the last pinned peek removes the document pointer listener", (t) => {
  const tree = [{ uid: "rk1000001", string: "ref kid", children: [] }];
  const h = harness({
    children: [blk("refAAAA01", "((target001))", { ":x": 0, ":y": 0, ":w": 240, ":h": 100 }, 0)],
    hostOverrides: { blockString: () => "target text", pullTree: () => tree },
  });
  t.after(h.restore);
  h.show();
  const downs = () => h.doc.listeners.get("pointerdown")?.size || 0;
  const before = downs();
  const cardEl = h.root.querySelector("[data-uid=refAAAA01]");
  h.stub.dispatch(cardEl, "mouseenter", { buttons: 0 });
  h.fire(PEEK_HOVER_MS);
  assert.ok(cardEl.querySelector(".pxd-link-peek"));
  h.stub.dispatch(cardEl, "pointerdown");
  assert.ok(downs() > before);
  h.r.closeCardPeek();
  assert.equal(downs(), before);
});

test("focusStep walks one crumb level and stops on the card", () => {
  const trail = [{ uid: "kidA00001", label: "child one" }, { uid: "kidA10001", label: "grandchild" }];
  const mid = focusStep(trail);
  assert.equal(mid.uid, "kidA00001");
  assert.deepEqual(mid.trail.map((t) => t.uid), ["kidA00001"]);
  assert.equal(focusStep(mid.trail).uid, null);
  assert.deepEqual(focusStep(mid.trail).trail, []);
  assert.equal(focusStep(null).uid, null);
});

test("a block uid addresses the card that contains it and opening the card itself does not", () => {
  const items = new Map([
    ["noteAAAA1", {
      uid: "noteAAAA1",
      type: "card",
      content: [{ ":block/uid": "kidA00001", children: [{ uid: "kidA10001" }] }],
    }],
    ["sectCCCC1", { uid: "sectCCCC1", type: "section", content: [{ uid: "kidA10001" }] }],
    ["refAAAA01", { uid: "refAAAA01", type: "card", kind: "block", target: { kind: "block", uid: "target01" }, content: [] }],
  ]);
  assert.deepEqual(cardOwningBlock(items, "kidA10001"), { cardUid: "noteAAAA1", blockUid: "kidA10001" });
  assert.equal(cardOwningBlock(items, "noteAAAA1"), null);
  assert.equal(cardOwningByParent(items, "noteAAAA1", () => ({ parentUid: "board0001" })), null);
  const parents = { deep00001: "mid000001", mid000001: "noteAAAA1" };
  assert.deepEqual(
    cardOwningByParent(items, "deep00001", (uid) => ({ parentUid: parents[uid] || "" })),
    { cardUid: "noteAAAA1", blockUid: "deep00001" },
  );
  assert.deepEqual(
    cardOwningByParent(items, "underref1", () => ({ parentUid: "target01" })),
    { cardUid: "refAAAA01", blockUid: "underref1" },
  );
  assert.equal(cardOwningByParent(items, "target01", () => ({ parentUid: "page00001" })), null);
  const calls = [];
  const records = [{ items, focusInside: (cardUid, blockUid) => calls.push([cardUid, blockUid]) }];
  assert.equal(focusOpenBlock(records, "kidA10001", () => null), true);
  assert.deepEqual(calls, [["noteAAAA1", "kidA10001"]]);
  assert.equal(focusOpenBlock(records, "noteAAAA1", () => null), false);
  assert.equal(calls.length, 1);
});

test("openBlock on a child of a page card focuses that card", () => {
  const page = {
    uid: "pagecard1",
    type: "card",
    kind: "page",
    target: { kind: "page", title: "Notes", uid: "pageUid01" },
    content: [],
  };
  const items = new Map([["pagecard1", page]]);
  const parents = { grand0001: "kid000001", kid000001: "pageUid01" };
  const parentOf = (uid) => ({ parentUid: parents[uid] || "" });
  assert.deepEqual(
    cardOwningByParent(items, "kid000001", parentOf),
    { cardUid: "pagecard1", blockUid: "kid000001" },
  );
  assert.deepEqual(
    cardOwningByParent(items, "grand0001", parentOf),
    { cardUid: "pagecard1", blockUid: "grand0001" },
  );
  assert.equal(cardOwningByParent(items, "pageUid01", () => ({ parentUid: "higher001" })), null);
  const bare = new Map([["pagecard1", {
    uid: "pagecard1",
    type: "card",
    kind: "page",
    target: { kind: "page", title: "Notes" },
    content: [],
  }]]);
  assert.deepEqual(
    cardOwningByParent(bare, "kid000001", parentOf, (title) => (title === "Notes" ? "pageUid01" : "")),
    { cardUid: "pagecard1", blockUid: "kid000001" },
  );
  const calls = [];
  const records = [{ items, focusInside: (cardUid, blockUid) => calls.push([cardUid, blockUid]) }];
  assert.equal(focusOpenBlock(records, "grand0001", parentOf), true);
  assert.deepEqual(calls, [["pagecard1", "grand0001"]]);
});

test("a grandchild bullet focuses card › parent › child; stepFocus walks back and writes nothing", (t) => {
  const h = harness({ children: [blk("noteAAAA1", "alpha", { ":x": 0, ":y": 0, ":w": 240, ":h": 100, ":kids": true }, 0, alpha)] });
  t.after(h.restore);
  h.show();
  const cardEl = h.root.querySelector("[data-uid=noteAAAA1]");
  cardEl.querySelector("[data-pxd-row=kidA10001] .pxd-outline__bullet").click();
  const crumb = cardEl.querySelector(".pxd-focus__crumb");
  assert.ok(crumb);
  assert.match(crumb.textContent, /alpha/);
  assert.match(crumb.textContent, /child one/);
  assert.match(crumb.textContent, /grandchild/);
  assert.equal(cardEl.querySelector("[data-pxd-row=kidB00001]"), null);
  assert.equal(h.r.stepFocus(), true);
  const mid = cardEl.querySelector(".pxd-focus__crumb");
  assert.match(mid.textContent, /alpha/);
  assert.match(mid.textContent, /child one/);
  assert.equal(/grandchild/.test(mid.textContent), false);
  assert.ok(cardEl.querySelector("[data-pxd-row=kidA10001]"));
  assert.equal(cardEl.querySelector("[data-pxd-row=kidB00001]"), null);
  assert.equal(h.r.stepFocus(), true);
  assert.equal(cardEl.querySelector(".pxd-focus__crumb"), null);
  assert.ok(cardEl.querySelector("[data-pxd-row=kidB00001]"));
  assert.equal(h.writes.length, 0);
  assert.equal(h.r.stepFocus(), false);
  h.r.dispose();
  const h2 = harness({ children: [blk("noteAAAA1", "alpha", { ":x": 0, ":y": 0, ":w": 240, ":h": 100, ":kids": true }, 0, alpha)] });
  t.after(h2.restore);
  h2.show();
  assert.equal(h2.root.querySelector(".pxd-focus__crumb"), null);
});
