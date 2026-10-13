// After a custom undo entry (fold sections, PDF pages, table captions) has written its inverse, the native entries
// below it no longer match Roam's stack: undo must stop there instead of calling data.undo().
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
    ],
  });
  const host = createHost({ api: fake.api, storage: stub.localStorage, graph: "g" });
  const session = acquireSession("b1", { host, raf: (fn) => fn() });
  return { fake, session, host, restore };
}
const undoCalls = (fake) => fake.calls.filter((c) => c[0] === "undo").length;
const redoCalls = (fake) => fake.calls.filter((c) => c[0] === "redo").length;
const snapshot = (fake) => JSON.stringify(["s0", "s1", "s0c", "c0"].map((u) => [fake.block(u).open, fake.props(u)]));

test("fold sections, undo, undo again: no native undo and no block change", async () => {
  const { fake, session, restore } = open();
  try {
    await session.foldSections(session.sectionFoldPlan(true));
    await session.undo();
    const before = snapshot(fake);
    fake.calls.length = 0;
    await session.undo();
    assert.equal(undoCalls(fake), 0);
    assert.equal(snapshot(fake), before);
  } finally { restore(); }
});

test("short native move, fold sections, undo, undo: the second undo stops at the floor", async () => {
  const { fake, session, restore } = open();
  try {
    await session.commitMove(["c0"], 5, 0);
    await session.foldSections(session.sectionFoldPlan(true));
    await session.undo();
    const before = snapshot(fake);
    fake.calls.length = 0;
    await session.undo();
    assert.equal(undoCalls(fake), 0);
    assert.equal(snapshot(fake), before);
  } finally { restore(); }
});

test("redo after a custom undo still works and leaves no native redo below it", async () => {
  const { fake, session, restore } = open();
  try {
    await session.commitMove(["c0"], 5, 0);
    await session.foldSections(session.sectionFoldPlan(true));
    await session.undo();
    await session.redo();
    assert.equal(fake.block("s0").open, false);
    fake.calls.length = 0;
    await session.redo();
    assert.equal(redoCalls(fake), 0);
    await session.undo();
    assert.equal(fake.block("s0").open, true);
    await session.undo();
    assert.equal(undoCalls(fake), 0);
  } finally { restore(); }
});

test("a foreign edit lifts the floor: the next undo is Roam's single step", async () => {
  const { fake, session, host, restore } = open();
  try {
    await session.foldSections(session.sectionFoldPlan(true));
    await session.undo();
    await new Promise((r) => setTimeout(r, 1000));
    host.invalidateUndo();
    fake.calls.length = 0;
    await session.undo();
    assert.equal(undoCalls(fake), 1);
  } finally { restore(); }
});

test("a transaction that fails midway closes as a native chunk of the writes that ran; undo reverts them", async () => {
  const { fake, session, restore } = open();
  try {
    const plan = session.sectionFoldPlan(true);
    const update = fake.api.data.block.update;
    let ran = 0;
    fake.api.data.block.update = (arg) => {
      if (ran >= 1) { fake.failNext = 100; }
      ran += 1;
      return update(arg);
    };
    await session.foldSections(plan);
    fake.failNext = 0;
    fake.api.data.block.update = update;
    const folded = ["s0", "s1"].filter((u) => fake.block(u).open === false);
    assert.equal(folded.length, 1, "exactly one write ran before the failure");
    fake.calls.length = 0;
    await session.undo();
    assert.equal(undoCalls(fake), 1, "one native undo for the one write that ran");
    assert.equal(fake.block(folded[0]).open, true);
  } finally { restore(); }
});
