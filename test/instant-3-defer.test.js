// INSTANT-3: the open pull does not run the linked-ref and card-stat reads in the same
// turn. They run in idle time after the board has painted, and they still arrive.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";

afterEach(() => resetSessions());

function open() {
  const stub = createDomStub();
  const restore = stub.install();
  const fake = createFakeRoam({ echoDelay: 0 });
  const host = createHost({ api: fake.api, storage: stub.localStorage, graph: "g" });
  fake.seedPage({ title: "A", uid: "pageA" });
  fake.seedBoard({
    uid: "b1",
    props: { plexus: { v: 2 } },
    children: [
      { uid: "c1", string: "[[A]]", props: { plexus: { x: 0, y: 0, w: 200, h: 100 } } },
      { uid: "c2", string: "Note", props: { plexus: { x: 280, y: 0, w: 200, h: 100 } } },
    ],
  });
  const stats = [];
  const realStats = host.cardStats.bind(host);
  host.cardStats = (targets, opts) => { stats.push(targets.length); return realStats(targets, opts); };
  const linked = fake.onQuery(/:find \?title/, () => []);
  return { stub, restore, fake, host, stats, linked };
}

test("the open reads the board; linked refs and card stats wait for idle and then arrive", () => {
  const ctx = open();
  try {
    const readsBefore = ctx.host.stats.reads;
    const session = acquireSession("b1", { host: ctx.host, raf: (fn) => fn() });
    assert.ok(session.board.items.has("c1"));
    assert.ok(ctx.host.stats.reads > readsBefore, "the board pull is counted as a read");
    assert.deepEqual(ctx.stats, [], "no card-stat read in the open turn");
    assert.equal(ctx.linked.calls.length, 0, "no linked-ref query in the open turn");
    for (let i = 0; i < 6 && (ctx.stub.idle.length || ctx.stub.timers.size); i += 1) {
      ctx.stub.flushIdle();
      ctx.stub.flushTimers();
    }
    assert.ok(ctx.stats.length >= 1, "card stats arrive after idle");
    assert.ok(ctx.linked.calls.length >= 1, "linked refs arrive after idle");
    session.release?.();
  } finally {
    ctx.restore();
  }
});

test("a board closed before idle skips the deferred reads", () => {
  const ctx = open();
  try {
    const session = acquireSession("b1", { host: ctx.host, raf: (fn) => fn() });
    session.destroy?.();
    session.release?.();
    resetSessions();
    for (let i = 0; i < 6 && (ctx.stub.idle.length || ctx.stub.timers.size); i += 1) {
      ctx.stub.flushIdle();
      ctx.stub.flushTimers();
    }
    assert.deepEqual(ctx.stats, []);
    assert.equal(ctx.linked.calls.length, 0);
  } finally {
    ctx.restore();
  }
});
