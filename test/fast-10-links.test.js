// FAST-10: graph links are computed after the first card paint, in an idle callback.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { mountBoardView } from "../src/view/board-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";

afterEach(() => resetSessions());

function seed(fake) {
  fake.seedPage({ title: "A", uid: "pageA" });
  fake.seedPage({ title: "B", uid: "pageB" });
  fake.seedPage({ title: "D", uid: "pageD" });
  fake.seedBoard({
    uid: "b1",
    props: { plexus: { v: 2 } },
    children: [
      { uid: "c1", string: "[[A]]", props: { plexus: { x: 0, y: 0, w: 200, h: 100 } } },
      { uid: "c2", string: "[[B]]", props: { plexus: { x: 280, y: 0, w: 200, h: 100 } } },
      {
        uid: "c4",
        string: "Hello",
        props: { plexus: { x: 0, y: 200, w: 200, h: 80 } },
        children: [{ uid: "k1", string: "kid" }],
      },
    ],
  });
}

function open({ view = false } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const idleOpts = [];
  const ric = globalThis.requestIdleCallback;
  globalThis.requestIdleCallback = (fn, opts) => {
    idleOpts.push(opts);
    return ric(fn, opts);
  };
  const fake = createFakeRoam({ echoDelay: 0 });
  const host = createHost({ api: fake.api, storage: stub.localStorage, graph: "g" });
  seed(fake);
  const eidA = host.resolveEid({ title: "A" });
  const eidB = host.resolveEid({ title: "B" });
  fake.setQ(() => [[eidA, eidB, "src1", "Causes:: [[B]]"]]);
  let queries = 0;
  const orig = host.q.bind(host);
  host.q = (...args) => {
    queries += 1;
    return orig(...args);
  };
  const session = acquireSession("b1", { host, raf: (fn) => fn() });
  let mounted = null;
  if (view) {
    const mountEl = stub.document.createElement("div");
    mountEl.className = "pxd-mount";
    stub.document.body.append(mountEl);
    mounted = mountBoardView({
      host,
      session,
      mountEl,
      settings: { get: () => undefined },
      version: "2.17.0",
      initialViewport: { x: 0, y: 0, zoom: 1 },
    });
  }
  return {
    stub,
    fake,
    host,
    session,
    mounted,
    idleOpts,
    queries: () => queries,
    restore() {
      try { mounted?.dispose(); } catch { /* already gone */ }
      restore();
    },
  };
}

function paintThenIdle(stub) {
  stub.flushFrames();
  stub.flushFrames();
  stub.flushIdle();
}

test("open publishes cards before runLinks, then links arrive on an idle callback with timeout 1s", async () => {
  const ctx = open({ view: true });
  try {
    const before = ctx.queries();
    assert.ok(ctx.session.board.items.has("c1"));
    assert.equal(ctx.session.links.length, 0);
    const events = [];
    ctx.session.on("links", () => events.push("links"));
    ctx.session.on("change", () => events.push("change"));
    const pending = ctx.session.linksPromise;

    ctx.stub.flushFrames();
    assert.ok(ctx.mounted.root.querySelector(".pxd-item"), "first frame paints a card");
    assert.equal(ctx.queries(), before, "runLinks does not run in the card-paint frame");
    assert.equal(ctx.session.links.length, 0);

    ctx.stub.flushFrames();
    assert.equal(ctx.queries(), before, "arming the idle callback does not query");
    assert.ok(ctx.idleOpts.some((opts) => opts && opts.timeout === 1000));

    ctx.stub.flushIdle();
    await pending;
    assert.equal(ctx.queries(), before + 1);
    assert.equal(ctx.session.links.length, 1);
    assert.equal(ctx.session.links[0].key, "c1->c2");
    assert.deepEqual(events, ["links"]);
  } finally {
    ctx.restore();
  }
});

test("a ref edit recomputes in a later idle callback; a move and a typing flush do not", async () => {
  const ctx = open();
  try {
    paintThenIdle(ctx.stub);
    await ctx.session.linksPromise;
    const afterOpen = ctx.queries();
    assert.equal(afterOpen > 0, true);

    await ctx.session.commitMove(["c4"], 24, 0);
    paintThenIdle(ctx.stub);
    assert.equal(ctx.queries(), afterOpen, "a move keeps the same refs");

    ctx.session.setEditing("c4");
    await ctx.fake.api.data.block.update({ block: { uid: "c4", string: "Hello!" } });
    await ctx.fake.flush();
    paintThenIdle(ctx.stub);
    assert.equal(ctx.session.board.items.get("c4").string, "Hello!");
    assert.equal(ctx.queries(), afterOpen, "typing on the open card does not query");
    ctx.session.setEditing(null);

    const framesBefore = ctx.stub.frames.length;
    await ctx.session.setString("c1", "[[D]]");
    assert.equal(ctx.queries(), afterOpen, "the ref edit does not query in the turn");
    assert.ok(ctx.stub.frames.length > framesBefore, "ref edit schedules the post-paint pass");
    paintThenIdle(ctx.stub);
    await ctx.session.linksPromise;
    assert.equal(ctx.queries(), afterOpen + 1);
  } finally {
    ctx.restore();
  }
});

test("destroy drops a scheduled link query", () => {
  const ctx = open();
  try {
    const before = ctx.queries();
    ctx.session.destroy();
    paintThenIdle(ctx.stub);
    assert.equal(ctx.queries(), before);
    assert.equal(ctx.session.links.length, 0);
  } finally {
    ctx.restore();
  }
});
