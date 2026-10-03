// P9 card children: CH-1 badge and kids prop, CH-2 outline rows, CH-3 peek, CH-4 spread. DOM stub and fake hosts only.
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { normalizeItemLayout, serializeItemLayout } from "../src/model/schema.js";
import { createInteractions } from "../src/view/interactions.js";
import { createItemRenderer } from "../src/view/cards.js";
import { buildMenu } from "../src/view/menu-model.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import "../src/session-clip.js";

afterEach(() => resetSessions());

const blk = (uid, string, plexus, order, children = []) => ({
  ":block/uid": uid,
  ":block/string": string,
  ":block/order": order,
  ":block/props": plexus ? { ":plexus": plexus } : {},
  ":block/children": children,
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
  const sess = { setKids: (...args) => { writes.push(args); return Promise.resolve(); }, ...session };
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
  const fire = (ms) => { for (const t of [...laterQueue].filter((x) => x.ms === ms)) { laterQueue.splice(laterQueue.indexOf(t), 1); t.fn(); } };
  return { stub, restore, doc, root, r, writes, load, show, laterQueue, fire, itemsLayer, host };
}

const alphaKids = [
  blk("kidA00001", "child one", null, 0, [blk("kidA10001", "grandchild", null, 0)]),
  blk("kidB00001", "child two", null, 1),
];
const note = (plexus = {}) => blk("noteAAAA1", "alpha", { ":x": 0, ":y": 0, ":w": 240, ":h": 100, ...plexus }, 0, alphaKids);

test("schema: kids is stored only when true and only on cards", () => {
  assert.equal(serializeItemLayout({ type: "card", x: 1, y: 2, kids: true }).kids, true);
  assert.equal("kids" in serializeItemLayout({ type: "card", x: 1, y: 2, kids: false }), false);
  assert.equal("kids" in serializeItemLayout({ type: "text", x: 1, y: 2, kids: true }), false);
  assert.equal(normalizeItemLayout({ kids: true }).kids, true);
  assert.equal(normalizeItemLayout({ kids: "yes" }).kids, undefined);
  assert.equal(normalizeItemLayout({ type: "section", kids: true }).kids, undefined);
});

test("CH-1: a note with children shows only its own block and a closed badge; nothing is written", (t) => {
  const h = harness({ children: [note()] });
  t.after(h.restore);
  h.show();
  const card = h.root.querySelector("[data-uid=noteAAAA1]");
  assert.equal(card.querySelector(".pxd-block"), null, "no child rows while kids is off");
  assert.match(card.querySelector(".pxd-item__string").textContent, /alpha/);
  const badge = card.querySelector(".pxd-kids");
  assert.ok(badge, "badge on the card");
  assert.equal(badge.textContent, "▸ 2");
  assert.equal(badge.getAttribute("aria-expanded"), "false");
  assert.ok(card.classList.contains("pxd-item--kidsoff"));
  assert.equal(h.writes.length, 0);
});

test("CH-1: a card with no children has no badge; the badge is gone at map LOD and returns at detail", (t) => {
  const h = harness({ children: [blk("lone00001", "lonely", { ":x": 0, ":y": 0, ":w": 240, ":h": 100 }, 0), note({ ":x": 400 })] });
  t.after(h.restore);
  h.show();
  assert.equal(h.root.querySelector("[data-uid=lone00001] .pxd-kids"), null);
  assert.ok(h.root.querySelector("[data-uid=noteAAAA1] .pxd-kids"));
  h.r.setLod("map", 0.3);
  assert.equal(h.root.querySelector(".pxd-kids"), null, "badge hidden at map LOD");
  h.show();
  assert.ok(h.root.querySelector("[data-uid=noteAAAA1] .pxd-kids"), "and back at detail");
});

test("CH-1/CH-2: kids on renders the children as rows tagged data-pxd-row and an open badge", (t) => {
  const h = harness({ children: [note({ ":kids": true })] });
  t.after(h.restore);
  h.show();
  const card = h.root.querySelector("[data-uid=noteAAAA1]");
  const rows = [...card.querySelectorAll(".pxd-block")];
  assert.equal(rows.length, 3, "two children and one grandchild");
  assert.deepEqual(rows.map((r) => r.getAttribute("data-pxd-row")), ["kidA00001", "kidA10001", "kidB00001"]);
  const badge = card.querySelector(".pxd-kids");
  assert.equal(badge.textContent, "▾ 2");
  assert.equal(badge.getAttribute("aria-expanded"), "true");
  assert.ok(card.classList.contains("pxd-item--kids"));
  assert.equal(card.classList.contains("pxd-item--kidsoff"), false);
});

test("CH-1: a badge click makes one setKids call, with a growth estimate, and does not reach the board", (t) => {
  const h = harness({ children: [note()] });
  t.after(h.restore);
  h.show();
  const badge = h.root.querySelector(".pxd-kids");
  let leaked = 0;
  h.root.addEventListener("pointerdown", () => { leaked += 1; });
  h.root.addEventListener("click", () => { leaked += 1; });
  h.stub.dispatch(badge, "pointerdown", { button: 0 });
  badge.click();
  assert.equal(leaked, 0, "pointerdown and click stop at the badge");
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0][0], "noteAAAA1");
  assert.equal(h.writes[0][1], true);
  assert.ok(h.writes[0][2] > 0, "extra height for the rows");
});

test("CH-1: toggleKids on the open card asks to close it, with no extra height", (t) => {
  const h = harness({ children: [note({ ":kids": true })] });
  t.after(h.restore);
  h.show();
  assert.equal(h.r.toggleKids("noteAAAA1"), true);
  assert.deepEqual(h.writes, [["noteAAAA1", false, 0]]);
});

test("CH-1: a block-ref card counts the referenced block's children and shows them only when kids is on", (t) => {
  const tree = [{ uid: "rk1000001", string: "ref kid", children: [] }, { uid: "rk2000001", string: "ref kid 2", children: [] }, { uid: "rk3000001", string: "((x))", children: [] }];
  const h = harness({
    children: [blk("refAAAA01", "((target001))", { ":x": 0, ":y": 0, ":w": 240, ":h": 100 }, 0), blk("refBBBB01", "((target001))", { ":x": 400, ":y": 0, ":w": 240, ":h": 100, ":kids": true }, 1)],
    hostOverrides: { blockString: () => "target text", pullTree: () => tree },
  });
  t.after(h.restore);
  h.show();
  const closed = h.root.querySelector("[data-uid=refAAAA01]");
  assert.equal(closed.querySelector(".pxd-kids").textContent, "▸ 3");
  assert.equal(closed.querySelector(".pxd-block"), null);
  const open = h.root.querySelector("[data-uid=refBBBB01]");
  assert.equal(open.querySelector(".pxd-kids").textContent, "▾ 3");
  assert.equal(open.querySelectorAll(".pxd-block").length, 3);
  assert.equal(h.writes.length, 0);
});

test("CH-1: a BT_attrDue child is not counted", (t) => {
  const h = harness({ children: [blk("dueAAAA01", "task", { ":x": 0, ":y": 0, ":w": 240, ":h": 100 }, 0, [blk("dueKid001", "BT_attrDue:: [[October 5th, 2026]]", null, 0)])] });
  t.after(h.restore);
  h.show();
  assert.equal(h.root.querySelector(".pxd-kids"), null);
});

test("CH-3: hovering the badge for 400 ms opens a read-only peek under the root; leaving closes it; no writes", (t) => {
  const many = Array.from({ length: 15 }, (_, i) => blk(`k${String(i).padStart(8, "0")}`, `child ${i}`, null, i));
  const h = harness({ children: [blk("manyAAAA1", "parent", { ":x": 0, ":y": 0, ":w": 240, ":h": 100 }, 0, many)] });
  t.after(h.restore);
  h.show();
  const badge = h.root.querySelector(".pxd-kids");
  h.stub.dispatch(badge, "mouseenter", { buttons: 0 });
  assert.equal(h.root.querySelector(".pxd-kids-peek"), null, "not before the delay");
  assert.ok(h.laterQueue.some((x) => x.ms === 400));
  h.fire(400);
  const peek = h.root.querySelector(".pxd-kids-peek");
  assert.ok(peek, "peek open");
  assert.equal(peek.parentElement, h.root, "portaled under the pxd root");
  assert.equal(peek.querySelectorAll(".pxd-kids-peek__row").length, 12, "at most 12 children");
  assert.equal(peek.querySelector("textarea, input"), null, "no editor");
  h.stub.dispatch(badge, "mouseleave", {});
  assert.equal(h.root.querySelector(".pxd-kids-peek"), null);
  assert.equal(h.writes.length, 0);
});

test("CH-3: a drag start, a wheel, a zoom change and dispose close the peek; a pressed button never opens it", (t) => {
  const h = harness({ children: [note()] });
  t.after(h.restore);
  h.show();
  const badge = h.root.querySelector(".pxd-kids");
  const open = () => { h.stub.dispatch(badge, "mouseenter", { buttons: 0 }); h.fire(400); return h.root.querySelector(".pxd-kids-peek"); };
  assert.ok(open());
  h.stub.dispatch(h.doc, "pointerdown", { button: 0 });
  assert.equal(h.root.querySelector(".pxd-kids-peek"), null, "pointerdown closes");
  h.stub.dispatch(badge, "mouseleave", {});
  assert.ok(open());
  h.stub.dispatch(h.doc, "wheel", { deltaY: 10 });
  assert.equal(h.root.querySelector(".pxd-kids-peek"), null, "wheel closes");
  h.stub.dispatch(badge, "mouseleave", {});
  assert.ok(open());
  h.r.setLod("detail", 2);
  assert.equal(h.root.querySelector(".pxd-kids-peek"), null, "zoom closes");
  h.stub.dispatch(badge, "mouseleave", {});
  h.stub.dispatch(badge, "mouseenter", { buttons: 1 });
  h.fire(400);
  assert.equal(h.root.querySelector(".pxd-kids-peek"), null, "no peek during a drag");
  assert.ok(open());
  h.r.dispose();
  assert.equal(h.root.querySelector(".pxd-kids-peek"), null, "dispose closes");
});

test("CH-4: the card menu lists Spread children as cards for note and block cards only", () => {
  const labels = (c) => buildMenu("card", { item: { look: "block" }, ...c }).map((m) => m.label);
  assert.ok(labels({ canSpread: true }).includes("Spread children as cards"));
  assert.equal(labels({ canSpread: false }).includes("Spread children as cards"), false);
});

// ------------------------------------------------------------------ session
const card = (uid, string, x, y, w = 200, h = 100, extra = {}, children = []) => ({
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
const kidsOf = (n) => Array.from({ length: n }, (_, i) => ({ uid: `c${String(i).padStart(3, "0")}`, string: `kid ${i}` }));
const creates = (fake) => fake.writesLog().filter((e) => e[0] === "create");
const updates = (fake) => fake.writesLog().filter((e) => e[0] === "update");

test("CH-1: setKids is one props write, keeps other keys, grows the card once, and off removes the key", async () => {
  const { fake, session } = setup([card("X", "note", 10, 20, 240, 100, { color: "teal" }, kidsOf(3))]);
  await session.setKids("X", true, 80);
  assert.equal(fake.writesLog().length, 1);
  assert.deepEqual(fake.props("X").plexus, { x: 10, y: 20, w: 240, h: 180, color: "teal", kids: true });
  fake.clearLog();
  await session.setKids("X", true, 80);
  assert.equal(fake.writesLog().length, 0, "already on is a no-op");
  await session.setKids("X", false);
  assert.equal(fake.writesLog().length, 1);
  assert.equal("kids" in fake.props("X").plexus, false);
  assert.equal(fake.props("X").plexus.h, 180, "closing keeps the height the user has");
});

test("CH-4: spreadChildren stacks block-ref cards right of the card with one arrow each, inside one undo group", async () => {
  const { fake, session } = setup([card("X", "note", 100, 100, 280, 160, {}, kidsOf(3))]);
  const res = await session.spreadChildren("X");
  assert.deepEqual([res.added, res.skipped], [3, 0]);
  const made = fake.children("b1").filter((u) => u !== "X").filter((u) => fake.block(u).string.startsWith("(("));
  assert.deepEqual(made.map((u) => fake.block(u).string), ["((c000))", "((c001))", "((c002))"]);
  const pos = made.map((u) => fake.props(u).plexus);
  assert.deepEqual(pos.map((p) => p.x), [420, 420, 420], "x = card.x + card.w + 40");
  assert.ok(pos[1].y > pos[0].y && pos[2].y > pos[1].y);
  const container = fake.children("b1").at(-1);
  const edges = fake.children(container).map((u) => fake.props(u).plexus);
  assert.equal(edges.length, 3);
  assert.ok(edges.every((e) => e.from === "X" && made.includes(e.to)));
  assert.equal(creates(fake).length, 7, "three cards, three arrows, one Connections container");
  assert.equal(updates(fake).length, 0);
  assert.ok(fake.writesLog().length <= 45);
});

test("CH-4: spreadChildren skips children already on the board as ref cards", async () => {
  const { fake, session } = setup([card("X", "note", 100, 100, 280, 160, {}, kidsOf(3)), card("have", "((c001))", 900, 900)]);
  const res = await session.spreadChildren("X");
  assert.deepEqual([res.added, res.skipped], [2, 1]);
  const strings = fake.children("b1").map((u) => fake.block(u).string);
  assert.equal(strings.filter((s) => s === "((c001))").length, 1);
  fake.clearLog();
  const again = await session.spreadChildren("X");
  assert.equal(again.added, 0);
  assert.equal(fake.writesLog().length, 0, "nothing left to spread writes nothing");
});

test("CH-4: spreadChildren stops at 22 cards with the cap toast and stays under the undo budget", async () => {
  const { fake, session } = setup([card("X", "note", 100, 100, 280, 160, {}, kidsOf(30))]);
  const toasts = [];
  session.on("toast", (t) => toasts.push(t.message));
  const res = await session.spreadChildren("X");
  assert.equal(res.added, 22);
  assert.deepEqual(toasts, ["Added 22 of 30 (Roam undo holds 50 changes)"]);
  assert.ok(fake.writesLog().length <= 45, `writes ${fake.writesLog().length}`);
});

// ------------------------------------------------------------------ CH-2 click a child row
test("CH-2: a click on a child row of an open note enters edit with that row; a closed note does not", () => {
  const board = buildBoard(rawBoard([note({ ":kids": true }), blk("closedAA1", "closed", { ":x": 600, ":y": 0, ":w": 240, ":h": 100 }, 1, alphaKids)]));
  const rects = worldRects(board);
  const calls = [];
  const ctl = createInteractions({
    actions: {
      board: () => board,
      rects: () => rects,
      viewport: () => ({ x: 0, y: 0, zoom: 1 }),
      size: () => ({ width: 1000, height: 800 }),
      editingUid: () => null,
      isEditing: () => false,
      enterEdit: (...args) => { calls.push(args); },
      setGesturing() {},
    },
  });
  const ev = (type, target, extra = {}) => ({ type, screen: { x: 10, y: 10 }, world: { x: 10, y: 10 }, target, button: 0, buttons: 1, ...extra });
  const open = { kind: "item", uid: "noteAAAA1", part: "body", row: "kidB00001" };
  ctl.handle(ev("pointerdown", open));
  ctl.handle(ev("pointerup", open, { buttons: 0 }));
  assert.deepEqual(calls, [["noteAAAA1", { row: "kidB00001" }]]);
  calls.length = 0;
  const closed = { kind: "item", uid: "closedAA1", part: "body", row: "kidB00001" };
  ctl.handle(ev("pointerdown", closed));
  ctl.handle(ev("pointerup", closed, { buttons: 0 }));
  assert.deepEqual(calls, []);
});

test("CH-2: enterEdit with a child row puts the caret in that child's input", async (t) => {
  const h = harness({ children: [note({ ":kids": true })] });
  t.after(h.restore);
  h.show();
  const focused = [];
  h.host.renderBlock = (el, uid) => {
    for (const id of ["noteAAAA1", "kidA00001", "kidB00001"]) {
      const input = h.doc.createElement("div");
      input.className = "rm-block__input";
      input.setAttribute("id", `block-input-card-body-outline-${uid}-${id}`);
      input.focus = () => { focused.push(id); };
      el.append(input);
    }
  };
  let done = false;
  let ok;
  h.r.enterEdit("noteAAAA1", { row: "kidB00001" }).then((v) => { ok = v; done = true; });
  for (let i = 0; i < 200 && !done; i += 1) {
    h.stub.flushFrames();
    for (const x of h.laterQueue.splice(0)) x.fn();
    await new Promise((r) => setTimeout(r, 8));
  }
  assert.equal(ok, true);
  assert.equal(focused[0], "kidB00001");
  assert.equal(h.root.querySelector("[data-uid=noteAAAA1] .pxd-kids"), null, "no badge while editing");
  await h.r.exitEdit({ silent: true });
});
