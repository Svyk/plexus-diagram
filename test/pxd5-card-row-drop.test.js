// PXD-5: a card dropped on a child row of another card adds the card's ref as the row's last child; the card snaps back.
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { noteSpeedFlags } from "../src/settings.js";
import { mountBoardView } from "../src/view/board-view.js";
import { ROW_DROP_HINT, createInteractions } from "../src/view/interactions.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { mount as mountWith, show, testTree, tick } from "./fixtures/ux4-b.js";
import "../src/session-clip.js";

afterEach(() => resetSessions());

// ---- session: refIntoRow

const card = (uid, string, x, y, extra = {}, children = []) => ({
  uid, string, props: { plexus: { x, y, w: 200, h: 100, ...extra } }, children,
});

function setup(children, { trackUndo = false } = {}) {
  const fake = createFakeRoam({ echoDelay: 0 });
  if (trackUndo) fake.trackUndo = true;
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({ uid: "b1", props: { plexus: { v: 2 } }, children });
  const session = acquireSession("b1", { host, settings: null, linkDelay: 0, raf: (fn) => fn() });
  fake.clearLog();
  return { fake, session };
}

const tree = () => [
  card("A", "alpha", 0, 0),
  card("T", "target", 300, 0, {}, [
    { uid: "R1", string: "row one", children: [{ uid: "R1a", string: "kept first" }] },
    { uid: "R2", string: "row two" },
  ]),
  card("P", "[[Page A]]", 600, 0),
  card("TC", "Caption", 900, 0, {}, [{ uid: "TB1", string: "{{[[table]]}}" }]),
  { uid: "SEC", string: "Section", props: { plexus: { type: "section", x: 0, y: 300, w: 400, h: 300 } }, children: [card("m1", "member", 20, 40)] },
  card("NB", "{{[[diagram]]:Inner}}", 500, 300, { v: 2 }),
];

test("refIntoRow: one ref per card under the row, last, in board order; sections and boards are skipped; nothing moves", async () => {
  const { fake, session } = setup(tree());
  const before = { A: fake.props("A"), P: fake.props("P"), TC: fake.props("TC") };
  const res = await session.refIntoRow(["TC", "P", "SEC", "NB", "A"], "R1");
  assert.equal(res.added, 3);
  const kids = fake.children("R1");
  assert.equal(kids[0], "R1a", "the row's own child stays first");
  assert.deepEqual(kids.slice(1).map((u) => fake.block(u).string), ["((A))", "[[Page A]]", "((TB1))"]);
  const log = fake.writesLog();
  assert.deepEqual(log.map((e) => e[0]), ["create", "create", "create"], "three creates, no move and no props write");
  assert.deepEqual({ A: fake.props("A"), P: fake.props("P"), TC: fake.props("TC") }, before);
  await res.undo();
  assert.deepEqual(fake.children("R1"), ["R1a"]);
});

test("refIntoRow writes under a row outside the board, and one Cmd+Z takes every ref back", async () => {
  const { fake, session } = setup(tree(), { trackUndo: true });
  fake.seedPage({ title: "Elsewhere", uid: "pgelse01", children: [{ uid: "outrow01", string: "a page block" }] });
  const res = await session.refIntoRow(["A", "P"], "outrow01");
  assert.equal(res.added, 2);
  assert.deepEqual(fake.children("outrow01").map((u) => fake.block(u).string), ["((A))", "[[Page A]]"]);
  await session.undo();
  assert.deepEqual(fake.children("outrow01"), []);
  assert.equal(fake.block("A").string, "alpha");
});

test("refIntoRow with only a section, a board or the row's own card writes nothing", async () => {
  const { fake, session } = setup(tree());
  assert.equal(await session.refIntoRow(["SEC", "NB"], "R1"), null);
  assert.equal(await session.refIntoRow(["A"], ""), null);
  assert.equal(await session.refIntoRow([], "R1"), null);
  assert.equal(fake.writesLog().length, 0);
});

// ---- view: the drag

const userCards = () => [
  { uid: "cardTT001", string: "This is a test", plexus: {}, children: testTree() },
  { uid: "cardSR001", string: "test" },
];

function mount(opts = {}) {
  const undone = [];
  const f = mountWith({
    cards: userCards(),
    host: { blockString: (uid) => (uid === "kidZ00001" ? "[[Todd Zenger]]" : null) },
    session: {
      refIntoRow: (...args) => {
        f.mutations.push(["refIntoRow", ...args]);
        return Promise.resolve({ added: args[0].length, undo: () => { undone.push(args[1]); } });
      },
    },
    ...opts,
  });
  f.undone = undone;
  return f;
}

const rowUids = (card) => [...card.querySelectorAll("[data-pxd-row]")]
  .filter((n) => !n.closest("[hidden]"))
  .map((n) => n.getAttribute("data-pxd-row"));

function dragCard(f, uid, { x = 500, y = 60 } = {}) {
  const el = f.view.root.querySelector(`[data-uid=${uid}]`);
  const base = { pointerId: 1, isPrimary: true, pointerType: "mouse", button: 0 };
  f.stub.dispatch(el, "pointerdown", { ...base, buttons: 1, clientX: x, clientY: y });
  return {
    move: (mx, my, extra = {}) => f.stub.dispatch(f.stub.document, "pointermove", { ...base, buttons: 1, clientX: mx, clientY: my, ...extra }),
    up: (mx, my, extra = {}) => f.stub.dispatch(f.stub.document, "pointerup", { ...base, buttons: 0, clientX: mx, clientY: my, ...extra }),
  };
}

// The held card sits on top under the pointer; below it the Todd Zenger row once it exists, else the target's body.
function stackUnderPointer(f, { onRow = true } = {}) {
  const held = f.view.root.querySelector("[data-uid=cardSR001]");
  const target = f.view.root.querySelector("[data-uid=cardTT001]");
  f.stub.document.elementsFromPoint = () => {
    const row = onRow ? target.querySelector("[data-pxd-row=kidZ00001] .pxd-block__text") : null;
    if (row) return [held, row, target];
    return [held, target.querySelector(".pxd-item__string") || target.querySelector(".pxd-item__body") || target, target];
  };
  return { held, target };
}

async function holdOverRow(f, g) {
  g.move(300, 60);
  g.move(100, 60);
  await tick(560);
  f.stub.flushFrames();
  g.move(100, 62);
}

test("PXD-5: a held card unfolds a folded card; a drop on a child row adds its ref there, the card snaps back and the target stays open", async () => {
  const f = mount();
  try {
    await show(f);
    const { held, target } = stackUnderPointer(f);
    const start = held.style.transform;
    const g = dragCard(f, "cardSR001");
    g.move(300, 60);
    g.move(100, 60);
    assert.deepEqual(rowUids(target), [], "no unfold before the hover wait");
    await tick(560);
    f.stub.flushFrames();
    assert.deepEqual(rowUids(target), ["kidT00001", "kidZ00001", "kidX00001", "kidD00001", "kidH00001"], "the hover unfolds the card");
    g.move(100, 62);
    assert.equal(target.querySelector("[data-pxd-row=kidZ00001]").classList.contains("pxd-row--target"), true, "the row under the pointer is lit");
    assert.equal(held.classList.contains("pxd-item--rowdrop"), true, "the held card turns see-through");
    assert.equal(f.view.root.querySelector(".pxd-connect-hint")?.textContent, ROW_DROP_HINT);
    g.up(100, 62);
    await tick();
    const drops = f.mutations.filter((m) => m[0] === "refIntoRow");
    assert.equal(drops.length, 1);
    assert.deepEqual(drops[0].slice(1), [["cardSR001"], "kidZ00001"]);
    assert.equal(f.mutations.filter((m) => m[0] === "commitMove").length, 0, "the card does not move");
    assert.equal(held.style.transform, start, "the card is back where the drag started");
    assert.equal(held.classList.contains("pxd-item--rowdrop"), false);
    assert.equal(f.view.root.querySelector(".pxd-connect-hint"), null);
    assert.equal(target.querySelector(".pxd-row--target"), null);
    await show(f);
    assert.equal(rowUids(target).length, 5, "the target stays unfolded so the new ref shows");
    const toast = f.view.root.querySelector(".pxd-toast");
    assert.equal(toast.querySelector(".pxd-toast__text").textContent, "Added a ref under “[[Todd Zenger]]”");
    assert.equal(toast.querySelector(".pxd-toast__action").textContent, "Undo");
    f.stub.dispatch(toast.querySelector(".pxd-toast__action"), "click", {});
    assert.deepEqual(f.undone, ["kidZ00001"]);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("PXD-5: Shift at the drop moves the card as before and the target folds back", async () => {
  const f = mount();
  try {
    await show(f);
    const { target } = stackUnderPointer(f);
    const g = dragCard(f, "cardSR001");
    await holdOverRow(f, g);
    assert.equal(target.querySelector("[data-pxd-row=kidZ00001]").classList.contains("pxd-row--target"), true);
    g.up(100, 62, { shiftKey: true });
    await tick();
    assert.equal(f.mutations.filter((m) => m[0] === "refIntoRow").length, 0);
    assert.equal(f.mutations.filter((m) => m[0] === "commitMove").length, 1);
    await show(f);
    assert.deepEqual(rowUids(target), [], "the hover unfold ends with the drag");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("PXD-5: Shift held while moving lights no row and does not unfold", async () => {
  const f = mount();
  try {
    await show(f);
    const { held, target } = stackUnderPointer(f);
    const g = dragCard(f, "cardSR001");
    g.move(300, 60, { shiftKey: true });
    g.move(100, 60, { shiftKey: true });
    await tick(560);
    f.stub.flushFrames();
    assert.deepEqual(rowUids(target), []);
    assert.equal(held.classList.contains("pxd-item--rowdrop"), false);
    g.up(100, 60, { shiftKey: true });
    await tick();
    assert.equal(f.mutations.filter((m) => m[0] === "refIntoRow").length, 0);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("PXD-5: a drop on the target card's own text, not a row, is a plain move", async () => {
  const f = mount();
  try {
    await show(f);
    const { held } = stackUnderPointer(f, { onRow: false });
    const g = dragCard(f, "cardSR001");
    await holdOverRow(f, g);
    assert.equal(held.classList.contains("pxd-item--rowdrop"), false);
    assert.equal(f.view.root.querySelector(".pxd-connect-hint"), null);
    g.up(100, 62);
    await tick();
    assert.equal(f.mutations.filter((m) => m[0] === "refIntoRow").length, 0);
    assert.equal(f.mutations.filter((m) => m[0] === "commitMove").length, 1);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("PXD-5: cardRowDrop off keeps the old move: no unfold, no lit row", async () => {
  noteSpeedFlags({ cardRowDrop: false });
  const f = mount();
  try {
    await show(f);
    const { target } = stackUnderPointer(f);
    const g = dragCard(f, "cardSR001");
    await holdOverRow(f, g);
    assert.deepEqual(rowUids(target), []);
    g.up(100, 62);
    await tick();
    assert.equal(f.mutations.filter((m) => m[0] === "refIntoRow").length, 0);
    assert.equal(f.mutations.filter((m) => m[0] === "commitMove").length, 1);
  } finally {
    f.view.dispose();
    f.restore();
    noteSpeedFlags(null);
  }
});

// ---- controller: which drag may drop on a row

function controller(items) {
  const board = { items: new Map(items.map((it) => [it.uid, it])), order: items.map((it) => it.uid), edges: new Map(), plexus: {} };
  const rects = new Map([["n1", { x: 0, y: 0, w: 100, h: 60 }], ["t1", { x: 0, y: 100, w: 100, h: 60 }], ["s1", { x: 0, y: 400, w: 120, h: 80 }], ["d1", { x: 300, y: 0, w: 200, h: 200 }]]);
  const calls = [];
  const ctl = createInteractions({ actions: {
    board: () => board, rects: () => rects, viewport: () => ({ x: 0, y: 0, zoom: 1 }), size: () => ({ width: 800, height: 600 }),
    commitMove: (...a) => calls.push(["commitMove", ...a]), rescheduleTasks: (...a) => calls.push(["rescheduleTasks", ...a]),
    refIntoRow: (...a) => calls.push(["refIntoRow", ...a]),
    blockTarget: (pt, opts) => { calls.push(["blockTarget", opts?.rowsOnly === true]); return { uid: "d1", row: "dayrow01" }; },
    dropReveal: (uid) => calls.push(["dropReveal", uid]),
    rowDropGhost: (uids) => calls.push(["rowDropGhost", uids]),
    onHover: () => {}, onSelection: () => {}, previewMove: () => {}, showGuides: () => {}, cancelPreview: () => {}, setGesturing: () => {},
    clearBlockTarget: () => {}, connectHint: () => {},
  } });
  const ev = (type, uid, world, extra = {}) => ({ type, world, screen: { x: world.x, y: world.y }, client: { x: world.x, y: world.y }, target: { kind: "item", uid, part: "body" }, button: 0, ...extra });
  const drag = (uid, from) => {
    ctl.handle(ev("pointerdown", uid, from));
    ctl.handle(ev("pointermove", uid, { x: 380, y: 40 }));
    ctl.handle(ev("pointerup", uid, { x: 380, y: 40 }));
    return calls;
  };
  return { drag };
}

const dayItems = () => [
  { uid: "n1", type: "card", kind: "note", string: "plain note", title: "plain note", content: [] },
  { uid: "t1", type: "card", kind: "note", string: "{{[[TODO]]}} x", title: "x", content: [] },
  { uid: "s1", type: "section", kind: "section", string: "Sec", title: "Sec", members: [], content: [] },
  { uid: "d1", type: "card", kind: "page", target: { title: "October 7th, 2026" }, title: "October 7th, 2026", content: [] },
];

test("PXD-5: a task held over a daily-page card keeps the due-date drop; a plain note takes the lit row", () => {
  const task = controller(dayItems()).drag("t1", { x: 50, y: 130 });
  assert.equal(task.some((c) => c[0] === "blockTarget"), false, "a task over a day card never asks for a row");
  assert.ok(task.some((c) => c[0] === "rescheduleTasks"));
  assert.equal(task.some((c) => c[0] === "refIntoRow"), false);
  const note = controller(dayItems()).drag("n1", { x: 50, y: 30 });
  assert.deepEqual(note.filter((c) => c[0] === "blockTarget"), [["blockTarget", true]]);
  assert.deepEqual(note.find((c) => c[0] === "dropReveal"), ["dropReveal", "d1"]);
  assert.deepEqual(note.find((c) => c[0] === "refIntoRow"), ["refIntoRow", ["n1"], "d1", "dayrow01"]);
  assert.equal(note.some((c) => c[0] === "commitMove" || c[0] === "rescheduleTasks"), false);
  assert.deepEqual(note.filter((c) => c[0] === "rowDropGhost"), [["rowDropGhost", ["n1"]], ["rowDropGhost", null]]);
});

test("PXD-5: a held section never lights a row", () => {
  const calls = controller(dayItems()).drag("s1", { x: 50, y: 430 });
  assert.equal(calls.some((c) => c[0] === "blockTarget" || c[0] === "refIntoRow"), false);
  assert.ok(calls.some((c) => c[0] === "commitMove"));
});

// ---- a block card shows the new ref under its row (its rows come from outside the board)

test("PXD-5: a drop on a block card's child row repaints that card with the new ref, and Undo takes it out again", async () => {
  const stub = createDomStub({ width: 1600, height: 900 });
  const restore = stub.install();
  const fake = createFakeRoam({ echoDelay: 0 });
  fake.roamWatch = true;
  stub.localStorage.setItem("plexus-diagram:vp:g:b1", JSON.stringify({ x: 0, y: 0, zoom: 1 }));
  fake.seedPage({ title: "Source Page", uid: "pgSrc001", children: [{ uid: "srcBlock1", string: "the source block", children: [{ uid: "srcRow001", string: "block row" }] }] });
  const host = createHost({ api: fake.api, storage: stub.localStorage, graph: "g" });
  fake.seedBoard({
    uid: "b1",
    props: { plexus: { v: 2 } },
    children: [
      { uid: "dragMe01", string: "dragged note", props: { plexus: { x: 0, y: 0, w: 280, h: 160 } } },
      { uid: "blockCd01", string: "((srcBlock1))", props: { plexus: { x: 800, y: 0, w: 280, h: 220, kids: true } } },
    ],
  });
  const session = acquireSession("b1", { host, settings: null, linkDelay: 0, raf: (fn) => fn() });
  const mountEl = stub.document.createElement("div");
  stub.document.body.append(mountEl);
  const view = mountBoardView({ host, session, mountEl, settings: { get: () => undefined }, version: "test" });
  const settle = async (ms) => {
    const end = Date.now() + ms;
    do {
      stub.flushFrames();
      stub.flushIdle();
      stub.flushMutations();
      await tick(40);
      await fake.flush();
    } while (Date.now() < end);
    stub.flushFrames();
  };
  const card = () => view.root.querySelector("[data-uid=blockCd01]");
  const rowTexts = () => [...card().querySelectorAll("[data-pxd-row]")].map((n) => String(n.textContent || "").replace(/\s+/g, " ").trim());
  try {
    await settle(400);
    assert.deepEqual(rowTexts(), ["[string:block row]"], "the block card shows its source's row");
    const held = view.root.querySelector("[data-uid=dragMe01]");
    stub.document.elementsFromPoint = () => {
      const row = card().querySelector("[data-pxd-row=srcRow001]");
      return row ? [held, row, card()] : [held, card()];
    };
    const base = { pointerId: 1, isPrimary: true, pointerType: "mouse", button: 0 };
    stub.dispatch(held, "pointerdown", { ...base, buttons: 1, clientX: 140, clientY: 80 });
    stub.dispatch(stub.document, "pointermove", { ...base, buttons: 1, clientX: 500, clientY: 60 });
    stub.dispatch(stub.document, "pointermove", { ...base, buttons: 1, clientX: 900, clientY: 60 });
    assert.equal(card().querySelector("[data-pxd-row=srcRow001]").classList.contains("pxd-row--target"), true, "the block card's row is lit");
    stub.dispatch(stub.document, "pointerup", { ...base, buttons: 0, clientX: 900, clientY: 60 });
    await settle(900);
    assert.deepEqual(fake.children("srcRow001").map((u) => fake.block(u).string), ["((dragMe01))"], "Roam has the ref under the row");
    assert.equal(rowTexts().length, 2, "the block card repainted with the new child row");
    assert.match(rowTexts()[1], /\(\(dragMe01\)\)/);
    assert.deepEqual(plexusXY(fake, "dragMe01"), { x: 0, y: 0 }, "the held card did not move");
    stub.dispatch(view.root.querySelector(".pxd-toast__action"), "click", {});
    await settle(900);
    assert.deepEqual(fake.children("srcRow001"), [], "Undo removed the ref");
    assert.deepEqual(rowTexts(), ["[string:block row]"], "the block card repainted without it");
  } finally {
    view.dispose();
    resetSessions();
    restore();
  }
});

function plexusXY(fake, uid) {
  const p = fake.props(uid)?.plexus || {};
  return { x: p.x, y: p.y };
}

// Real Roam does not call the board's pull watch for an edit inside a joined ref (host watchBlock note), so each card kind
// must repaint by its own path: a note card through the optimistic board model, a page card through its page watch, a block
// card through the row watch. The board watch is muted here.
test("PXD-5: with the board watch muted, note, page and block cards each show the new ref after a drop", async () => {
  const kinds = [
    { name: "note", target: "noteCd001", row: "noteRow01", card: { uid: "noteCd001", string: "target note", props: { plexus: { x: 800, y: 0, w: 280, h: 260, kids: true } }, children: [{ uid: "noteRow01", string: "note row" }] } },
    { name: "page", target: "pageCd001", row: "pgRow001", page: { title: "Target Page", uid: "pgTarget1", children: [{ uid: "pgRow001", string: "page row" }] }, card: { uid: "pageCd001", string: "[[Target Page]]", props: { plexus: { x: 800, y: 0, w: 320, h: 360 } } } },
    { name: "block", target: "blockCd01", row: "srcRow001", page: { title: "Source Page", uid: "pgSrc001", children: [{ uid: "srcBlock1", string: "the source block", children: [{ uid: "srcRow001", string: "block row" }] }] }, card: { uid: "blockCd01", string: "((srcBlock1))", props: { plexus: { x: 800, y: 0, w: 280, h: 260, kids: true } } } },
  ];
  for (const k of kinds) {
    resetSessions();
    const stub = createDomStub({ width: 1600, height: 900 });
    const restore = stub.install();
    const fake = createFakeRoam({ echoDelay: 0 });
    fake.roamWatch = true;
    const addWatch = fake.api.data.addPullWatch.bind(fake.api.data);
    fake.api.data.addPullWatch = (pattern, entity, cb) => addWatch(pattern, entity, String(entity).includes('"b1"') ? () => undefined : cb);
    stub.localStorage.setItem("plexus-diagram:vp:g:b1", JSON.stringify({ x: 0, y: 0, zoom: 1 }));
    if (k.page) fake.seedPage(k.page);
    const host = createHost({ api: fake.api, storage: stub.localStorage, graph: "g" });
    fake.seedBoard({ uid: "b1", props: { plexus: { v: 2 } }, children: [{ uid: "dragMe01", string: "dragged note", props: { plexus: { x: 0, y: 0, w: 280, h: 160 } } }, k.card] });
    const session = acquireSession("b1", { host, settings: null, linkDelay: 0, raf: (fn) => fn() });
    const mountEl = stub.document.createElement("div");
    stub.document.body.append(mountEl);
    const view = mountBoardView({ host, session, mountEl, settings: { get: () => undefined }, version: "test" });
    const settle = async (ms) => {
      const end = Date.now() + ms;
      do {
        stub.flushFrames();
        stub.flushIdle();
        stub.flushMutations();
        await tick(40);
        await fake.flush();
      } while (Date.now() < end);
      stub.flushFrames();
    };
    const card = () => view.root.querySelector(`[data-uid=${k.target}]`);
    const rowTexts = () => [...card().querySelectorAll("[data-pxd-row]")].map((n) => String(n.textContent || "").replace(/\s+/g, " ").trim());
    try {
      await settle(400);
      assert.equal(rowTexts().length, 1, `${k.name}: one row before the drop`);
      const held = view.root.querySelector("[data-uid=dragMe01]");
      stub.document.elementsFromPoint = () => {
        const row = card().querySelector(`[data-pxd-row=${k.row}]`);
        return row ? [held, row, card()] : [held, card()];
      };
      const base = { pointerId: 1, isPrimary: true, pointerType: "mouse", button: 0 };
      stub.dispatch(held, "pointerdown", { ...base, buttons: 1, clientX: 140, clientY: 80 });
      stub.dispatch(stub.document, "pointermove", { ...base, buttons: 1, clientX: 500, clientY: 60 });
      stub.dispatch(stub.document, "pointermove", { ...base, buttons: 1, clientX: 900, clientY: 60 });
      stub.dispatch(stub.document, "pointerup", { ...base, buttons: 0, clientX: 900, clientY: 60 });
      await settle(900);
      assert.deepEqual(fake.children(k.row).map((u) => fake.block(u).string), ["((dragMe01))"], `${k.name}: Roam has the ref`);
      assert.ok(rowTexts().some((t) => t.includes("((dragMe01))")) && rowTexts().length === 2, `${k.name}: the card shows the new row: ${JSON.stringify(rowTexts())}`);
    } finally {
      view.dispose();
      resetSessions();
      restore();
    }
  }
});
