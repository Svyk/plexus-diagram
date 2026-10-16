import assert from "node:assert/strict";
import test from "node:test";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";

const COUNT = 80;

function setup() {
  const stub = createDomStub();
  const restore = stub.install();
  const fake = createFakeRoam({ echoDelay: 0 });
  fake.trackUndo = true;
  fake.seedBoard({ uid: "b1", props: { plexus: { v: 2 } }, children: Array.from({ length: COUNT }, (_, i) => ({ uid: `c${i}`, string: `card ${i}`, props: { plexus: { x: i * 10, y: 0, w: 200, h: 100 } } })) });
  const host = createHost({ api: fake.api, storage: stub.localStorage, graph: "g" });
  const session = acquireSession("b1", { host, raf: (fn) => fn() });
  const xs = () => Array.from({ length: COUNT }, (_, i) => fake.props(`c${i}`)?.plexus?.x);
  const uids = Array.from({ length: COUNT }, (_, i) => `c${i}`);
  return { fake, session, xs, uids, done: () => { resetSessions(); restore(); } };
}

test("a move over 45 writes is one undo, and a second undo does not take a native step", async () => {
  const { fake, session, xs, uids, done } = setup();
  try {
    const orig = xs();
    await session.commitMove(uids, 7, 0);
    assert.notDeepEqual(xs(), orig);
    fake.calls.length = 0;
    await session.undo();
    assert.deepEqual(xs(), orig);
    assert.equal(fake.calls.filter((c) => c[0] === "undo").length, 0);
    await session.undo();
    assert.deepEqual(xs(), orig);
    assert.equal(fake.calls.filter((c) => c[0] === "undo").length, 0);
  } finally { done(); }
});

test("a long move undoes back to the previous step, and the next undo stops at the native floor", async () => {
  const { fake, session, xs, uids, done } = setup();
  try {
    const orig = xs();
    await session.commitMove(["c0"], 5, 0);
    const afterShort = xs();
    await session.commitMove(uids, 7, 0);
    await session.undo();
    assert.deepEqual(xs(), afterShort);
    fake.calls.length = 0;
    await session.undo();
    assert.deepEqual(xs(), afterShort, "the short move stays: a custom undo drops the native entries under it");
    assert.equal(fake.calls.filter((c) => c[0] === "undo").length, 0);
    assert.notDeepEqual(afterShort, orig);
  } finally { done(); }
});
