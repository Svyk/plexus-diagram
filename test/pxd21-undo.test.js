// PXD-21: Plexus undo keeps Roam's own undo history intact, and a toast's Undo reverts the change it reports.
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";

afterEach(() => resetSessions());

function open() {
  const stub = createDomStub();
  const restore = stub.install();
  const fake = createFakeRoam({ echoDelay: 0 });
  fake.trackUndo = true;
  fake.seedBoard({
    uid: "b1",
    props: { plexus: { v: 2 } },
    children: [
      { uid: "s0", string: "S0", props: { plexus: { type: "section", x: 0, y: 0, w: 480, h: 300 } }, children: [{ uid: "s0c", string: "card", props: { plexus: { x: 10, y: 40, w: 200, h: 100 } } }] },
      { uid: "s1", string: "S1", props: { plexus: { type: "section", x: 500, y: 0, w: 480, h: 300 } } },
      { uid: "c0", string: "loose", props: { plexus: { x: 0, y: 900, w: 200, h: 100 } } },
      { uid: "c1", string: "other", props: { plexus: { x: 400, y: 900, w: 200, h: 100 } } },
    ],
  });
  const host = createHost({ api: fake.api, storage: stub.localStorage, graph: "g" });
  const session = acquireSession("b1", { host, raf: (fn) => fn() });
  return { fake, session, host, restore };
}
const xOf = (fake, uid) => fake.props(uid)?.plexus?.x;
const calls = (fake, name) => fake.calls.filter((c) => c[0] === name).length;

test("a small custom entry (fold sections) undoes with Roam's own undo: no inverse writes, older steps stay", async () => {
  const { fake, session, restore } = open();
  try {
    await session.commitMove(["c0"], 5, 0);
    assert.equal(xOf(fake, "c0"), 5);
    const beforeFold = fake.nativeDepth().undo;
    await session.foldSections(session.sectionFoldPlan(true));
    assert.equal(fake.block("s0").open, false);
    fake.calls.length = 0;
    await session.undo();
    assert.equal(fake.block("s0").open, true);
    assert.equal(fake.block("s1").open, true);
    assert.equal(fake.calls.filter((c) => c[0] !== "undo").length, 0, "no inverse writes reach Roam's stack");
    assert.equal(fake.nativeDepth().undo, beforeFold, "Roam's stack is back to where it was before the fold");
    // The move under the fold is still undoable (before PXD-21 the log was dropped and this undo did nothing).
    await session.undo();
    assert.equal(xOf(fake, "c0"), 0);
    await session.redo();
    assert.equal(xOf(fake, "c0"), 5);
    await session.redo();
    assert.equal(fake.block("s0").open, false);
  } finally { restore(); }
});

test("after a Plexus undo of a fold, Roam's own Cmd+Z reaches the older change, not a stray inverse", async () => {
  const { fake, session, restore } = open();
  try {
    await session.commitMove(["c0"], 5, 0);
    await session.foldSections(session.sectionFoldPlan(true));
    await session.undo();
    // Roam's own Cmd+Z, outside Plexus.
    await fake.api.data.undo();
    assert.equal(xOf(fake, "c0"), 0, "Roam's undo walks back the move");
    assert.equal(fake.block("s0").open, true, "and does not fold the sections again");
  } finally { restore(); }
});

test("a custom entry with a page write keeps its own inverse and the floor", async () => {
  const { fake, host, restore } = open();
  try {
    fake.pageCreateEntries = 2; // real Roam may stack more than one entry for a page
    let undone = 0;
    await host.group(async () => {
      host.setCustomUndo({ undo: async () => { undone += 1; }, redo: async () => {} });
      await host.createPage({ title: "PXD21 page" });
      await host.setOpen("s1", false);
    });
    fake.calls.length = 0;
    await host.undo();
    assert.equal(undone, 1, "the recorded inverse ran");
    assert.equal(calls(fake, "undo"), 0, "no native undo for a group with an inexact write");
    await host.undo();
    assert.equal(calls(fake, "undo"), 0, "the floor holds");
  } finally { restore(); }
});

test("native: false keeps the inverse even for a small group (chunked apply order)", async () => {
  const { fake, host, restore } = open();
  try {
    let undone = 0;
    await host.group(async () => {
      host.setCustomUndo({ native: false, undo: async () => { undone += 1; }, redo: async () => {} });
      await host.setOpen("s1", false);
    });
    fake.calls.length = 0;
    await host.undo();
    assert.equal(undone, 1);
    assert.equal(calls(fake, "undo"), 0);
  } finally { restore(); }
});

test("toast Undo reverts its own change only while that change is on top", async () => {
  const { fake, session, restore } = open();
  try {
    await session.commitMove(["c0"], 5, 0);
    const markA = await session.undoMark();
    await session.commitMove(["c1"], 7, 0);
    assert.equal(await session.undoChange(markA), false, "a later change sits above A");
    assert.equal(xOf(fake, "c0"), 5);
    assert.equal(xOf(fake, "c1"), 407, "B stays");
    const markB = await session.undoMark();
    assert.equal(await session.undoChange(markB), true);
    assert.equal(xOf(fake, "c1"), 400, "B reverted");
    assert.equal(xOf(fake, "c0"), 5, "A untouched");
    // A second click on B's toast, or B undone already with Cmd+Z: nothing older is undone.
    assert.equal(await session.undoChange(markB), false);
    assert.equal(xOf(fake, "c0"), 5);
    // A's toast works again now that A is on top.
    assert.equal(await session.undoChange(markA), true);
    assert.equal(xOf(fake, "c0"), 0);
  } finally { restore(); }
});

test("toast Undo after Cmd+Z already undid the change does nothing", async () => {
  const { fake, session, restore } = open();
  try {
    await session.commitMove(["c0"], 5, 0);
    await session.commitMove(["c1"], 7, 0);
    const markB = await session.undoMark();
    await session.undo();
    assert.equal(xOf(fake, "c1"), 400);
    assert.equal(await session.undoChange(markB), false);
    assert.equal(xOf(fake, "c0"), 5, "the older move is not undone by B's toast");
  } finally { restore(); }
});

test("a queued change that wrote nothing marks 0, not the change below it", async () => {
  const { fake, session, restore } = open();
  try {
    await session.commitMove(["c0"], 5, 0);
    const after = session.undoSeq();
    void session.deleteRegion("not-a-region");
    const mark = await session.undoMark(after);
    assert.equal(mark, 0);
    assert.equal(await session.undoChange(mark), false);
    assert.equal(xOf(fake, "c0"), 5);
  } finally { restore(); }
});

test("a queued delete marks itself: its toast Undo brings the card back", async () => {
  const { fake, session, restore } = open();
  try {
    await session.commitMove(["c0"], 5, 0);
    const after = session.undoSeq();
    void session.deleteItems(["c1"]);
    const mark = await session.undoMark(after);
    assert.ok(mark > 0);
    assert.ok(!fake.block("c1"), "c1 deleted");
    assert.equal(await session.undoChange(mark), true);
    assert.ok(fake.block("c1"), "c1 is back");
    assert.equal(xOf(fake, "c0"), 5, "the earlier move stays");
  } finally { restore(); }
});

test("a change split into several native chunks is undone whole by its toast", async () => {
  const { fake, session, host, restore } = open();
  try {
    await session.commitMove(["c0"], 5, 0);
    await host.group(async () => {
      for (let i = 0; i < 50; i++) await host.setOpen(i % 2 ? "s0" : "s1", i % 2 === 0);
    });
    await host.group(async () => { await host.setOpen("s1", false); await host.setOpen("s0", false); });
    const mark = host.undoMark();
    assert.equal(await session.undoChange(mark), true);
    fake.calls.length = 0;
    const big = host.undoMark();
    assert.ok(big > 0 && big !== mark);
    assert.equal(await session.undoChange(big), true);
    assert.equal(calls(fake, "undo"), 50, "both chunks (45 + 5) of the one change");
    assert.equal(xOf(fake, "c0"), 5);
  } finally { restore(); }
});
