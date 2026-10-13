// F9/F10: an action over 45 writes is one custom undo entry (one Cmd+Z), not one native undo per chunk of 45.
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";

afterEach(() => resetSessions());

const COUNT = 80;
function open() {
  const stub = createDomStub();
  const restore = stub.install();
  const fake = createFakeRoam({ echoDelay: 0 });
  fake.trackUndo = true;
  fake.seedBoard({
    uid: "b1",
    props: { plexus: { v: 2 } },
    children: Array.from({ length: COUNT }, (_, i) => ({ uid: `c${i}`, string: `card ${i}`, props: { plexus: { x: i * 10, y: 0, w: 200, h: 100 } } })),
  });
  const host = createHost({ api: fake.api, storage: stub.localStorage, graph: "g" });
  const session = acquireSession("b1", { host, raf: (fn) => fn() });
  return { fake, host, session, restore };
}
const xs = (fake) => Array.from({ length: COUNT }, (_, i) => fake.props(`c${i}`)?.plexus?.x);

test("80 prop writes undo and redo in one step each, without native undos", async () => {
  const { fake, session, restore } = open();
  try {
    const before = xs(fake);
    const uids = Array.from({ length: COUNT }, (_, i) => `c${i}`);
    await session.commitMove(uids, 7, 0);
    const moved = xs(fake);
    assert.deepEqual(moved, before.map((x) => x + 7));
    fake.calls.length = 0;
    await session.undo();
    assert.deepEqual(xs(fake), before, "one undo restores every card");
    assert.equal(fake.calls.filter((c) => c[0] === "undo").length, 0, "no native Roam undo was used");
    await session.redo();
    assert.deepEqual(xs(fake), moved, "one redo moves them all again");
  } finally {
    restore();
  }
});

test("a short action keeps native undo", async () => {
  const { fake, session, restore } = open();
  try {
    await session.commitMove(["c0", "c1"], 5, 0);
    fake.calls.length = 0;
    await session.undo();
    assert.ok(fake.calls.filter((c) => c[0] === "undo").length > 0);
  } finally {
    restore();
  }
});

test("a long action with deletes keeps the native chunked undo (a delete cannot be written back exactly)", async () => {
  const { fake, session, restore } = open();
  try {
    const uids = Array.from({ length: 60 }, (_, i) => `c${i}`);
    await session.deleteItems(uids);
    fake.calls.length = 0;
    await session.undo();
    assert.ok(fake.calls.filter((c) => c[0] === "undo").length > 0, "native undo used");
  } finally {
    restore();
  }
});
