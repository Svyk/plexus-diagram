// UX4 lane B: child focus from real clicks, refold, drop onto a child row.
// The user's card: "This is a test" › test › [[Todd Zenger]] › TEST › [[Donald Trump's Grip…]] › [[Tech]].
import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { crumbLabels, editorHost, mount as mountWith, pulled, realClick, settleEdit, show, testTree, tick } from "./fixtures/ux4-b.js";

const userCards = (kids) => [
  { uid: "cardTT001", string: "This is a test", plexus: kids ? { ":kids": true, ":h": 260 } : {}, children: testTree() },
  { uid: "cardSR001", string: "test" },
];

const mount = (opts = {}) => mountWith({ cards: userCards(false), ...opts });

const rowUids = (card) => [...card.querySelectorAll("[data-pxd-row]")]
  .filter((n) => !n.closest("[hidden]"))
  .map((n) => n.getAttribute("data-pxd-row"));

// The session's setKids lands in Roam and the pull watch hands the board back.
function applyKids(f, on) {
  const next = buildBoard(pulled(userCards(on)));
  f.session.board = next;
  f.session.rects = worldRects(next);
  f.session.listeners.change?.({ dirty: new Set(["cardTT001"]), structural: false });
}

test("B1: Children button → unfold → real click on bullets at depth 2, 4 and 5 focuses each; Escape steps back", async () => {
  const f = mount();
  try {
    await show(f);
    const card = f.view.root.querySelector("[data-uid=cardTT001]");
    const kidsBtn = card.querySelector(".pxd-kids");
    assert.ok(kidsBtn, "the folded card has the Children button");
    realClick(f.stub, kidsBtn);
    assert.deepEqual(f.mutations.find((m) => m[0] === "setKids")?.slice(1, 3), ["cardTT001", true]);
    applyKids(f, true);
    await show(f);
    assert.deepEqual(rowUids(card), ["kidT00001", "kidZ00001", "kidX00001", "kidD00001", "kidH00001"]);
    realClick(f.stub, card.querySelector("[data-pxd-row=kidZ00001] .pxd-outline__bullet"));
    await show(f);
    assert.deepEqual(crumbLabels(card), ["This is a test", "test", "Todd Zenger"]);
    assert.equal(card.querySelector("[data-pxd-row=kidZ00001]").classList.contains("pxd-outline--zoomed"), true);
    realClick(f.stub, card.querySelector("[data-pxd-row=kidD00001] .pxd-outline__bullet"));
    await show(f);
    assert.equal(crumbLabels(card).at(-1).startsWith("Donald Trump"), true);
    realClick(f.stub, card.querySelector("[data-pxd-row=kidH00001] .pxd-outline__bullet"));
    await show(f);
    assert.equal(crumbLabels(card).at(-1), "Tech");
    assert.deepEqual(rowUids(card), ["kidH00001"]);
    f.stub.dispatch(f.stub.window, "keydown", { key: "Escape" });
    await show(f);
    assert.equal(crumbLabels(card).at(-1).startsWith("Donald Trump"), true);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

// B3: the user's frames. Focus a child, fold: the card went on showing the crumb and the rows.
test("B3: unfold → focus depth 2 → fold → unfold → fold puts the card back to its stored folded size and plain top block", async () => {
  const f = mount();
  try {
    await show(f);
    const card = f.view.root.querySelector("[data-uid=cardTT001]");
    const folded = { h: card.style.height, rows: rowUids(card) };
    assert.deepEqual(folded.rows, []);
    const kids = () => card.querySelector(".pxd-kids");
    realClick(f.stub, kids());
    applyKids(f, true);
    await show(f);
    realClick(f.stub, card.querySelector("[data-pxd-row=kidZ00001] .pxd-outline__bullet"));
    await show(f);
    assert.deepEqual(crumbLabels(card), ["This is a test", "test", "Todd Zenger"]);
    f.mutations.length = 0;
    realClick(f.stub, kids());
    assert.deepEqual(f.mutations.filter((m) => m[0] === "setKids").map((m) => m.slice(1, 3)), [["cardTT001", false]]);
    applyKids(f, false);
    await show(f);
    assert.deepEqual(crumbLabels(card), [], "no crumb after fold");
    assert.deepEqual(rowUids(card), [], "no leftover rows after fold");
    assert.equal(card.style.height, folded.h, "the stored folded height");
    realClick(f.stub, kids());
    applyKids(f, true);
    await show(f);
    assert.deepEqual(crumbLabels(card), [], "unfold again shows the whole outline, not the old focus");
    assert.deepEqual(rowUids(card), ["kidT00001", "kidZ00001", "kidX00001", "kidD00001", "kidH00001"]);
    realClick(f.stub, kids());
    applyKids(f, false);
    await show(f);
    assert.deepEqual(rowUids(card), []);
    assert.equal(card.style.height, folded.h);
    assert.equal(f.mutations.some((m) => m[0] === "commitRects" || m[0] === "growToFit"), false, "fold writes no height of its own");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("B3: Escape to the top from a focus on a folded card (focused through a peek or a link) leaves no rows", async () => {
  const f = mount();
  try {
    await show(f);
    const card = f.view.root.querySelector("[data-uid=cardTT001]");
    const h = card.style.height;
    f.view.focusInside("cardTT001", "kidX00001");
    await show(f);
    assert.equal(crumbLabels(card).at(-1), "TEST");
    for (let i = 0; i < 3; i += 1) {
      f.stub.dispatch(f.stub.window, "keydown", { key: "Escape" });
      await show(f);
    }
    assert.deepEqual(crumbLabels(card), []);
    assert.deepEqual(rowUids(card), []);
    assert.equal(card.style.height, h);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("B1: hover the Children button, move into the peek, click a depth-2 row: the card shows that block focused, with no write; the Children button folds it back", async () => {
  const f = mount();
  try {
    await show(f);
    const card = f.view.root.querySelector("[data-uid=cardTT001]");
    const h = card.style.height;
    const kidsBtn = card.querySelector(".pxd-kids");
    f.stub.dispatch(kidsBtn, "mouseenter", {});
    await tick(450);
    await show(f);
    const peek = f.view.root.querySelector(".pxd-kids-peek");
    assert.ok(peek, "the peek opens on hover");
    f.stub.dispatch(kidsBtn, "mouseleave", {});
    f.stub.dispatch(peek, "mouseenter", {});
    await tick(450);
    assert.ok(peek.isConnected, "the peek stays open while the pointer crosses into it");
    const row = peek.querySelector("[data-pxd-peek-row=kidZ00001]");
    assert.ok(row, "depth-2 rows are pickable");
    realClick(f.stub, row);
    await show(f);
    assert.equal(peek.isConnected, false);
    assert.deepEqual(crumbLabels(card), ["This is a test", "test", "Todd Zenger"]);
    assert.equal(card.querySelector("[data-pxd-row=kidZ00001]").classList.contains("pxd-outline--zoomed"), true);
    assert.equal(f.mutations.length, 0, "picking a child writes nothing");
    realClick(f.stub, card.querySelector(".pxd-kids"));
    await show(f);
    assert.equal(f.mutations.length, 0, "folding back a peek pick writes nothing");
    assert.deepEqual(crumbLabels(card), []);
    assert.deepEqual(rowUids(card), []);
    assert.equal(card.style.height, h);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("B1: editing a card focused on a child edits that block (Roam's zoom): the crumb stays, the editor mounts the focused block, Escape keeps the focus", async () => {
  const rendered = [];
  const f = mount({ cards: userCards(true), host: editorHost(rendered) });
  try {
    await show(f);
    const card = f.view.root.querySelector("[data-uid=cardTT001]");
    realClick(f.stub, card.querySelector("[data-pxd-row=kidZ00001] .pxd-outline__bullet"));
    await show(f);
    assert.deepEqual(crumbLabels(card), ["This is a test", "test", "Todd Zenger"]);
    const row = card.querySelector("[data-pxd-row=kidX00001] .pxd-block__text");
    f.stub.dispatch(row, "dblclick", { clientX: 60, clientY: 80 });
    await settleEdit(f.stub);
    assert.equal(card.classList.contains("pxd-item--editing"), true);
    assert.deepEqual(rendered, ["kidZ00001"], "the editor mounts the focused block, not the whole card");
    assert.equal(card.classList.contains("pxd-item--focusedit"), true);
    const body = card.querySelector(".pxd-item__body");
    const crumb = card.querySelector(".pxd-focus__crumb");
    assert.equal(crumb?.parentElement, body, "the crumb stays on screen above the editor, outside the fading static layer");
    assert.deepEqual(crumbLabels(card), ["This is a test", "test", "Todd Zenger"]);
    f.stub.dispatch(f.stub.window, "keydown", { key: "Escape" });
    await settleEdit(f.stub);
    await show(f);
    assert.equal(card.classList.contains("pxd-item--editing"), false);
    assert.equal(card.classList.contains("pxd-item--focusedit"), false);
    assert.deepEqual(crumbLabels(card), ["This is a test", "test", "Todd Zenger"]);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

// ---- B2: drop an arrow onto a child of a folded card.
function dragArrow(f, { from, to, waitMs = 0 }) {
  const port = f.view.root.querySelector(`[data-uid=${from}] .pxd-port`);
  assert.ok(port, "the source card has a connect port");
  const base = { pointerId: 1, isPrimary: true, pointerType: "mouse", button: 0 };
  f.stub.dispatch(port, "pointerdown", { ...base, buttons: 1, clientX: 660, clientY: 60 });
  return {
    move: (x, y) => f.stub.dispatch(f.stub.document, "pointermove", { ...base, buttons: 1, clientX: x, clientY: y }),
    up: (x, y) => f.stub.dispatch(f.stub.document, "pointerup", { ...base, buttons: 0, clientX: x, clientY: y }),
  };
}

test("B2: an arrow held over a folded card with children unfolds it (no write); dropping on a child row connects to that block; the card folds back", async () => {
  const f = mount();
  try {
    await show(f);
    const card = f.view.root.querySelector("[data-uid=cardTT001]");
    const h = card.style.height;
    // The element under the pointer: the Todd Zenger row once it exists, else the card body.
    f.stub.document.elementsFromPoint = () => {
      const row = card.querySelector("[data-pxd-row=kidZ00001] .pxd-block__text");
      return row ? [row, card] : [card.querySelector(".pxd-item__body") || card, card];
    };
    const g = dragArrow(f, { from: "cardSR001" });
    g.move(500, 60);
    g.move(100, 60);
    assert.deepEqual(rowUids(card), [], "no unfold before the hover wait");
    await tick(560);
    f.stub.flushFrames();
    assert.deepEqual(rowUids(card), ["kidT00001", "kidZ00001", "kidX00001", "kidD00001", "kidH00001"], "the hover unfolds the card");
    assert.equal(f.mutations.length, 0, "unfold on hover writes nothing");
    g.move(100, 62);
    assert.equal(card.querySelector("[data-pxd-row=kidZ00001]").classList.contains("pxd-row--target"), true, "the row under the pointer is the drop target");
    g.up(100, 62);
    await tick();
    const adds = f.mutations.filter((m) => m[0] === "addEdge");
    assert.equal(adds.length, 1);
    assert.equal(adds[0][1].from, "cardSR001");
    assert.equal(adds[0][1].to, "cardTT001");
    assert.equal(adds[0][1].toBlock, "kidZ00001", "the arrow ends on the child block");
    await show(f);
    assert.deepEqual(rowUids(card), [], "the card folds back after the drop");
    assert.equal(card.style.height, h);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("B2: leaving the card without dropping folds it back; dropping on the card's own text keeps the whole-card arrow", async () => {
  const f = mount();
  try {
    await show(f);
    const card = f.view.root.querySelector("[data-uid=cardTT001]");
    f.stub.document.elementsFromPoint = () => [card.querySelector(".pxd-item__string") || card, card];
    const g = dragArrow(f, { from: "cardSR001" });
    g.move(100, 60);
    await tick(560);
    f.stub.flushFrames();
    assert.equal(rowUids(card).length, 5);
    g.move(330, 300);
    f.stub.flushFrames();
    assert.deepEqual(rowUids(card), [], "leaving the hover refolds");
    g.move(100, 20);
    await tick(560);
    g.up(100, 20);
    await tick();
    const adds = f.mutations.filter((m) => m[0] === "addEdge");
    assert.equal(adds.length, 1);
    assert.equal(adds[0][1].to, "cardTT001");
    assert.equal(adds[0][1].toBlock, undefined);
    assert.equal(f.mutations.filter((m) => m[0] !== "addEdge").length, 0);
  } finally {
    f.view.dispose();
    f.restore();
  }
});
