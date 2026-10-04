// P15 Better Tasks cards. A fake window.RoamExtensionTools stands in for Better Tasks; nothing here writes a BT_attr block.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { afterEach } from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { createBt } from "../src/host/bt.js";
import { dayChoices, isBareTask, isTaskAttr, setTaskAttrNames, taskAttrId, taskMeta } from "../src/model/tasks.js";
import { createItemRenderer } from "../src/view/cards.js";
import { createInteractions } from "../src/view/interactions.js";
import { createTaskPopover } from "../src/view/task-popover.js";
import { mountKanban } from "../src/view/kanban-view.js";
import { freshCardIsBlank } from "../src/view/board-view.js";
import { buildMenu } from "../src/view/menu-model.js";
import { createDomStub } from "./fixtures/dom-stub.js";

afterEach(() => setTaskAttrNames(null));

const TODAY = new Date(2026, 9, 3);
const kid = (string, uid = "k") => ({ ":block/uid": uid, ":block/string": string, ":block/children": [] });

function fakeWin({ names, projects = ["EMP", "Ops"], failModify = false } = {}) {
  const calls = [];
  const attributes = names || [
    { id: "due", name: "BT_attrDue", aliases: [] },
    { id: "project", name: "Proj", aliases: ["BT_attrProject"] },
    { id: "priority", name: "BT_attrPriority", aliases: [] },
  ];
  const tools = [
    { name: "bt_get_attributes", execute: async () => { calls.push(["bt_get_attributes"]); return { surface: "Child", attributes }; } },
    { name: "bt_get_projects", execute: async (a) => { calls.push(["bt_get_projects", a]); return { projects: projects.map((name) => ({ name })) }; } },
    { name: "bt_modify", execute: async (a) => { calls.push(["bt_modify", a]); return failModify ? { error: "Task not found" } : { uid: a.uid }; } },
  ];
  return { calls, win: { RoamExtensionTools: { "better-tasks": { name: "Better Tasks", tools } } } };
}

test("bt: absent registry means unavailable and every call reports it instead of throwing", async () => {
  const bt = createBt({ win: {} });
  assert.equal(bt.available(), false);
  assert.deepEqual(await bt.modify("u1", { status: "DONE" }), { ok: false, reason: "unavailable" });
  assert.deepEqual(await bt.projects(), []);
  assert.equal(await bt.prime(), null);
});

test("bt: modify sends only what was asked and turns an error result into ok:false", async () => {
  const f = fakeWin();
  const bt = createBt({ win: f.win });
  assert.equal(bt.available(), true);
  assert.deepEqual(await bt.modify("u1", { attributes: { due: "2026-10-04" } }), { ok: true, result: { uid: "u1" } });
  await bt.modify("u1", { status: "DONE" });
  assert.deepEqual(f.calls.filter((c) => c[0] === "bt_modify").map((c) => c[1]), [{ uid: "u1", attributes: { due: "2026-10-04" } }, { uid: "u1", status: "DONE" }]);
  const bad = createBt({ win: fakeWin({ failModify: true }).win });
  assert.equal((await bad.modify("u1", { status: "DONE" })).ok, false);
});

test("bt: attribute labels and aliases come from bt_get_attributes, and a renamed label is a task attribute", async () => {
  const bt = createBt({ win: fakeWin().win });
  const names = await bt.prime();
  assert.ok(names.get("project").has("proj") && names.get("project").has("bt_attrproject"));
  assert.equal(taskAttrId("Proj:: [[EMP]]", names), "project");
  assert.equal(taskAttrId("Proj:: [[EMP]]"), null, "unknown until Better Tasks answers");
  assert.equal(taskAttrId("BT_attrWhatever:: x"), "other", "the BT_attr prefix is the fallback");
  assert.equal(taskAttrId("**Activity log**"), "activity", "Better Tasks' activity log child is bookkeeping");
  setTaskAttrNames(names);
  assert.equal(isTaskAttr(kid("Proj:: [[EMP]]")), true);
  assert.equal(isTaskAttr(kid("Status:: Done")), false);
  assert.deepEqual(await bt.projects(), ["EMP", "Ops"]);
});

test("taskMeta reads due, project, priority, repeat and status; overdue and today are by day", () => {
  const content = [kid("BT_attrDue:: [[October 3rd, 2026]]", "a"), kid("BT_attrProject:: [[EMP]] {{or: [[A]] | [[B]]}}", "b"), kid("BT_attrPriority:: high", "c"), kid("BT_attrRepeat:: every Friday", "d"), kid("a plain child", "e")];
  const m = taskMeta("{{[[TODO]]}} ship #[[task-status/Waiting]]", content, TODAY);
  assert.equal(m.due.short, "Oct 3");
  assert.equal(m.due.today, true);
  assert.equal(m.due.overdue, false);
  assert.equal(m.project, "EMP");
  assert.equal(m.priorityGlyph, "!!!");
  assert.equal(m.repeat, "every Friday");
  assert.equal(m.status, "Waiting");
  const late = taskMeta("{{[[TODO]]}} x", [kid("BT_attrDue:: [[October 1st, 2026]]")], TODAY);
  assert.equal(late.due.overdue, true);
  assert.equal(taskMeta("{{[[DONE]]}} x", [kid("BT_attrDue:: [[October 1st, 2026]]")], TODAY).due.overdue, false, "a done task is not overdue");
  assert.equal(taskMeta("{{[[TODO]]}} x #[[task-status/Cancelled]]", [], TODAY).cancelled, true);
  assert.equal(taskMeta("plain note", [], TODAY), null);
});

test("task helpers: a bare marker is empty, quick picks are ISO days", () => {
  assert.equal(isBareTask("{{[[TODO]]}} "), true);
  assert.equal(isBareTask("{{[[TODO]]}} #[[task-status/Active]]"), true);
  assert.equal(isBareTask("{{[[TODO]]}} wash"), false);
  assert.deepEqual(dayChoices(TODAY).map((c) => c.value), ["2026-10-03", "2026-10-04", "2026-10-05"]);
  assert.equal(freshCardIsBlank({ blockString: "{{[[TODO]]}} ", itemString: "{{[[TODO]]}} ", contentCount: 0, editorText: "{{[[TODO]]}} " }), true);
  assert.equal(freshCardIsBlank({ blockString: "{{[[TODO]]}} wash", itemString: "", contentCount: 0 }), false);
});

// ---------------------------------------------------------------- cards

const blk = (uid, string, plexus, order, children = []) => ({
  ":block/uid": uid, ":block/string": string, ":block/order": order,
  ":block/props": plexus ? { ":plexus": plexus } : {}, ":block/children": children,
});

function cardHarness({ children, bt = null, onTaskChip = null } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const calls = { renderBlock: [], renderString: [] };
  const host = {
    renderString(node, string) { calls.renderString.push(string); node.textContent = string; },
    renderBlock(node, uid, opts) { calls.renderBlock.push([uid, opts]); node.textContent = `live:${uid}`; },
    unmount() {}, blockString: () => null, pullTree: () => [], pullBoard: () => null,
    pagePreview: () => ({ exists: false, blocks: [] }),
  };
  const root = doc.createElement("div");
  root.className = "pxd-root";
  doc.body.append(root);
  const sectionsLayer = doc.createElement("div");
  const itemsLayer = doc.createElement("div");
  root.append(sectionsLayer);
  root.append(itemsLayer);
  const idleQueue = [];
  const timers = { idle(fn) { idleQueue.push(fn); return () => {}; }, later() { return () => {}; } };
  const r = createItemRenderer({ doc, host, session: { setKids: async () => {} }, itemsLayer, sectionsLayer, timers, bt, onTaskChip });
  const board = buildBoard({ ":block/uid": "board0001", ":block/string": "{{[[diagram]]:Test}}", ":block/props": { ":plexus": { ":v": 2 } }, ":block/children": children });
  r.sync({ board, rects: worldRects(board), dirty: null, structural: true });
  r.setShowBadges(true);
  r.setLod("detail", 1);
  r.scheduleContent({ visibleRect: { x: -10000, y: -10000, w: 20000, h: 20000 }, zoom: 1, tier: "detail" });
  let guard = 0;
  while (idleQueue.length && guard++ < 50) idleQueue.shift()({ timeRemaining: () => 10, didTimeout: false });
  r.setBadges(new Map());
  return { stub, restore, doc, root, r, calls, host };
}

const taskCard = (extraKids = []) => blk("task00001", "{{[[TODO]]}} ship", { ":x": 0, ":y": 0, ":w": 280, ":h": 160 }, 0, [
  { ...kid("BT_attrDue:: [[October 1st, 2026]]", "due000001") },
  { ...kid("BT_attrProject:: [[EMP]]", "prj000001") },
  { ...kid("BT_attrPriority:: high", "pri000001") },
  ...extraKids,
]);

test("BT-1: attribute children never count as children, badge or rows", () => {
  const h = cardHarness({ children: [taskCard()] });
  try {
    const card = h.root.querySelector("[data-uid=task00001]");
    assert.equal(card.querySelector(".pxd-kids"), null, "only attribute children: no children badge");
    assert.equal(card.textContent.includes("BT_attr"), false);
  } finally { h.restore(); }
  const real = cardHarness({ children: [taskCard([kid("a real subtask", "sub000001")])] });
  try {
    assert.equal(real.root.querySelector("[data-uid=task00001] .pxd-kids").textContent, "▸ 1", "one real subtask counts");
  } finally { real.restore(); }
});

test("BT-2: a task card with Better Tasks draws the title through renderBlock closed, and shows chips", async () => {
  const f = fakeWin();
  const bt = createBt({ win: f.win });
  const picks = [];
  const h = cardHarness({ children: [taskCard()], bt, onTaskChip: (uid, kind) => picks.push([uid, kind]) });
  try {
    assert.deepEqual(h.calls.renderBlock, [["task00001", { open: false }]]);
    assert.equal(h.calls.renderString.length, 0);
    const card = h.root.querySelector("[data-uid=task00001]");
    assert.ok(card.classList.contains("pxd-item--task"));
    assert.ok(card.classList.contains("pxd-item--task-overdue"));
    assert.equal(card.querySelector(".pxd-item__header").getAttribute("data-task-due"), "Oct 1");
    const chips = [...card.querySelectorAll(".pxd-badge-chip")];
    assert.deepEqual(chips.map((c) => c.textContent), ["Oct 1", "EMP", "!!!"]);
    assert.ok(chips[0].classList.contains("pxd-badge-chip--overdue"));
    chips[1].click();
    assert.deepEqual(picks, [["task00001", "project"]]);
    assert.match(chips[0].title, /Cmd\+Z there is Roam's undo/);
  } finally { h.restore(); }
});

test("BT-2: without Better Tasks the card keeps renderString, shows read-only chips and no editors", () => {
  const h = cardHarness({ children: [taskCard()] });
  try {
    assert.equal(h.calls.renderBlock.length, 0);
    assert.ok(h.calls.renderString.includes("{{[[TODO]]}} ship"));
    const card = h.root.querySelector("[data-uid=task00001]");
    assert.equal(card.querySelectorAll("[data-task-chip]").length, 0);
    assert.deepEqual([...card.querySelectorAll(".pxd-badge-chip")].map((c) => c.textContent), ["Oct 1", "EMP", "!!!"]);
  } finally { h.restore(); }
});

test("BT-10: task-chips due only keeps the date, none removes the row", () => {
  const bt = createBt({ win: fakeWin().win });
  const h = cardHarness({ children: [taskCard()], bt, onTaskChip() {} });
  try {
    const card = h.root.querySelector("[data-uid=task00001]");
    h.r.setTaskChips("due only");
    assert.deepEqual([...card.querySelectorAll(".pxd-badge-chip")].map((c) => c.textContent), ["Oct 1"]);
    h.r.setTaskChips("none");
    assert.equal(card.querySelectorAll(".pxd-badge-chip").length, 0);
  } finally { h.restore(); }
});

// ---------------------------------------------------------------- popover, kanban, drop, menu

test("BT-4: a due pick calls bt_modify with an ISO day; Escape closes without a write", async () => {
  const f = fakeWin();
  const bt = createBt({ win: f.win });
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const root = stub.document.createElement("div");
    stub.document.body.append(root);
    const pop = createTaskPopover({ doc: stub.document, root, bt, today: () => TODAY });
    const anchor = stub.document.createElement("button");
    root.append(anchor);
    assert.equal(pop.open("task00001", "due", anchor), true);
    const buttons = [...root.querySelectorAll(".pxd-task-pop__btn")];
    assert.deepEqual(buttons.map((b) => b.textContent), ["Today", "Tomorrow", "Next week", "Clear"]);
    stub.dispatch(stub.document, "keydown", { key: "Escape" });
    assert.equal(pop.isOpen(), false);
    assert.equal(f.calls.filter((c) => c[0] === "bt_modify").length, 0);
    pop.open("task00001", "due", anchor);
    [...root.querySelectorAll(".pxd-task-pop__btn")][1].click();
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(f.calls.filter((c) => c[0] === "bt_modify").map((c) => c[1]), [{ uid: "task00001", attributes: { due: "2026-10-04" } }]);
    assert.equal(pop.isOpen(), false);
    const none = createTaskPopover({ doc: stub.document, root, bt: createBt({ win: {} }) });
    assert.equal(none.open("task00001", "due", anchor), false, "no editors without Better Tasks");
  } finally { restore(); }
});

test("BT-6: a Kanban drop to Done goes through Better Tasks; a refusal falls back to the marker", async () => {
  const run = async (bt) => {
    const stub = createDomStub();
    const root = stub.document.createElement("div");
    const board = { order: ["c1"], items: new Map([["c1", { uid: "c1", type: "card", kind: "note", parentUid: "b", string: "{{[[TODO]]}} Wash", title: "Wash", content: [] }]]) };
    const writes = [];
    const host = { group: (fn) => fn(), updateString: (uid, string) => { writes.push([uid, string]); board.items.get(uid).string = string; } };
    const view = mountKanban({ doc: stub.document, root, host, bt, getBoard: () => board });
    view.open();
    root.querySelector(".pxd-kanban__card").dispatchEvent({ type: "pointerdown" });
    [...root.querySelectorAll(".pxd-kanban__column")].find((col) => col.getAttribute("data-column") === "Done").dispatchEvent({ type: "pointerup" });
    await new Promise((r) => setTimeout(r, 0));
    view.dispose();
    return writes;
  };
  const f = fakeWin();
  assert.deepEqual(await run(createBt({ win: f.win })), [], "Better Tasks wrote it, Plexus did not");
  assert.deepEqual(f.calls.filter((c) => c[0] === "bt_modify").map((c) => c[1]), [{ uid: "c1", status: "DONE" }]);
  assert.deepEqual(await run(createBt({ win: fakeWin({ failModify: true }).win })), [["c1", "{{[[DONE]]}} Wash"]]);
  assert.deepEqual(await run(null), [["c1", "{{[[DONE]]}} Wash"]]);
});

test("BT-7: dropping a task on a daily-page card asks to reschedule; Shift moves only", () => {
  const items = new Map([
    ["t1", { uid: "t1", type: "card", kind: "note", string: "{{[[TODO]]}} x", title: "x", content: [] }],
    ["d1", { uid: "d1", type: "card", kind: "page", target: { title: "October 7th, 2026" }, title: "October 7th, 2026", content: [] }],
  ]);
  const board = { items, order: ["t1", "d1"], edges: new Map(), plexus: {} };
  const rects = new Map([["t1", { x: 0, y: 0, w: 100, h: 60 }], ["d1", { x: 300, y: 0, w: 200, h: 100 }]]);
  const make = () => {
    const calls = [];
    const ctl = createInteractions({ actions: {
      board: () => board, rects: () => rects, viewport: () => ({ x: 0, y: 0, zoom: 1 }), size: () => ({ width: 800, height: 600 }),
      commitMove: (...a) => calls.push(["commitMove", ...a]), rescheduleTasks: (...a) => calls.push(["rescheduleTasks", ...a]),
      onHover: () => {}, onSelection: () => {}, previewMove: () => {}, showGuides: () => {}, cancelPreview: () => {}, setGesturing: () => {},
    } });
    return { ctl, calls };
  };
  const ev = (type, world, extra = {}) => ({ type, world, screen: { x: world.x, y: world.y }, target: { kind: "item", uid: "t1", part: "body" }, button: 0, ...extra });
  const drag = (shift) => {
    const { ctl, calls } = make();
    ctl.handle(ev("pointerdown", { x: 50, y: 30 }));
    ctl.handle(ev("pointermove", { x: 380, y: 40 }, { shift }));
    ctl.handle(ev("pointerup", { x: 380, y: 40 }, { shift }));
    return calls;
  };
  const plain = drag(false);
  assert.deepEqual(plain.find((c) => c[0] === "rescheduleTasks").slice(1), [["t1"], { uid: "d1", title: "October 7th, 2026", iso: "2026-10-07" }]);
  assert.ok(plain.some((c) => c[0] === "commitMove"), "the card still moves");
  assert.equal(drag(true).some((c) => c[0] === "rescheduleTasks"), false);
});

test("BT-4/8: the canvas menu has New task and a note card has Make task; a task card does not", () => {
  const canvas = buildMenu("canvas", {}).map((m) => m.id);
  assert.ok(canvas.includes("new-task"));
  const flat = (rows) => rows.flatMap((r) => [r.id, ...(r.children ? flat(r.children) : [])]);
  assert.ok(flat(buildMenu("card", { item: { look: "block" }, canMakeTask: true })).includes("make-task"));
  assert.equal(flat(buildMenu("card", { item: { look: "block" }, canMakeTask: false })).includes("make-task"), false);
});

test("BT-2: task CSS hides Better Tasks pills inside a card and gives dark mode borders, not fills", async () => {
  const css = await readFile(new URL("../src/css/task.css", import.meta.url), "utf8");
  assert.match(css, /\.pxd-root \.pxd-item \.rt-pill-wrap \{\s*display: none/);
  const tinted = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => /background-image/.test(m[2]));
  assert.ok(tinted.length > 0 && tinted.every((m) => /:not\(\.pxd-root--dark\)/.test(m[1])), "tints are light mode only");
  for (const m of css.matchAll(/([^{}]+)\{/g)) assert.match(m[1].trim(), /\.pxd-root/, `scoped: ${m[1].trim()}`);
});
