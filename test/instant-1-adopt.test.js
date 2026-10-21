// INSTANT-1: a painted snapshot hands its shells to the live board. A card that persists keeps
// its DOM node; moves, text changes, adds and removes reconcile; nothing is written.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { mountBoardView } from "../src/view/board-view.js";
import { captureBoardSnap, paintBoardSnap, SNAP_CLASS } from "../src/view/boardsnap-paint.js";
import { parseSnapshot, packSnapshot } from "../src/model/boardsnap.js";
import { noteSpeedFlags } from "../src/settings.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";

afterEach(() => {
  resetSessions();
  noteSpeedFlags(null);
});

function seed(fake) {
  fake.seedPage({ title: "A", uid: "pageA" });
  fake.seedBoard({
    uid: "b1",
    props: { plexus: { v: 2 } },
    children: [
      { uid: "c1", string: "Keep me", props: { plexus: { x: 0, y: 0, w: 200, h: 100 } } },
      { uid: "c2", string: "Move me", props: { plexus: { x: 280, y: 0, w: 200, h: 100 } } },
      { uid: "c3", string: "Retitle me", props: { plexus: { x: 0, y: 200, w: 200, h: 80 } } },
      { uid: "c4", string: "Delete me", props: { plexus: { x: 280, y: 200, w: 200, h: 80 } } },
    ],
  });
}

function env({ eager = true } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  noteSpeedFlags(eager ? '{"budgetedMount":false}' : null);
  const fake = createFakeRoam({ echoDelay: 0 });
  const host = createHost({ api: fake.api, storage: stub.localStorage, graph: "g" });
  seed(fake);
  const mountOne = (extra = {}) => {
    const session = acquireSession("b1", { host, raf: (fn) => fn() });
    const mountEl = stub.document.createElement("div");
    mountEl.className = "pxd-mount";
    stub.document.body.append(mountEl);
    const view = mountBoardView({
      host,
      session,
      mountEl,
      settings: { get: () => undefined },
      version: "test",
      initialViewport: { x: 0, y: 0, zoom: 1 },
      ...extra,
    });
    return { session, mountEl, view };
  };
  return { stub, restore, fake, host, mountOne };
}

function shellOf(root, uid) {
  return root.querySelectorAll(".pxd-item").find((node) => node.getAttribute("data-uid") === uid) || null;
}

test("snapshot shells are adopted by uid: same node, moved, retitled; a deleted card goes, a new one is built", async () => {
  const e = env();
  try {
    // 1. A settled board, captured.
    const first = e.mountOne();
    e.stub.flushFrames();
    e.stub.flushFrames();
    const src = first.view.snapshotSource();
    assert.ok(src, "a live view exposes its snapshot source");
    const raw = captureBoardSnap({ ...src, uid: "b1" });
    assert.equal(raw.items.length, 4);
    const snap = parseSnapshot(packSnapshot(raw));
    assert.ok(snap);
    first.view.dispose();
    first.session.release?.();
    resetSessions();

    // 2. The graph changes while the board is closed.
    await e.fake.api.data.block.update({ block: { uid: "c2", props: { plexus: { x: 600, y: 40, w: 200, h: 100 } } } });
    await e.fake.api.data.block.update({ block: { uid: "c3", string: "New title" } });
    await e.fake.api.data.block.delete({ block: { uid: "c4" } });
    await e.fake.api.data.block.create({ location: { "parent-uid": "b1", order: "last" }, block: { uid: "c5", string: "Brand new", props: { plexus: { x: 0, y: 400, w: 200, h: 80 } } } });
    await e.fake.flush?.();
    e.fake.clearLog();

    // 3. Paint the snapshot, then mount the live board with it.
    const mountEl = e.stub.document.createElement("div");
    mountEl.className = "pxd-mount";
    e.stub.document.body.append(mountEl);
    const painted = paintBoardSnap(e.stub.document, mountEl, snap, { x: 0, y: 0, zoom: 1 });
    assert.ok(painted);
    const before = new Map([...painted.shells].map(([uid, node]) => [uid, node]));
    for (const node of before.values()) {
      assert.ok(node.classList.contains(SNAP_CLASS));
      assert.equal(node.listeners.size, 0, "a snapshot shell has no listeners");
      assert.equal(node.querySelector("textarea"), null);
    }
    assert.equal(shellOf(painted.root, "c3").querySelector(".pxd-item__header").textContent, "Retitle me");

    const session = acquireSession("b1", { host: e.host, raf: (fn) => fn() });
    let firstPaints = 0;
    const view = mountBoardView({
      host: e.host,
      session,
      mountEl,
      settings: { get: () => undefined },
      version: "test",
      initialViewport: { x: 0, y: 0, zoom: 1 },
      snapshot: { snap, shells: painted.shells },
      onFirstPaint: () => { firstPaints += 1; },
    });
    assert.equal(firstPaints, 0, "the live board draws on the next frame");
    e.stub.flushFrames();
    assert.equal(firstPaints, 1);
    e.stub.flushFrames();
    assert.equal(firstPaints, 1, "first paint fires once");

    const live = view.root;
    const c1 = shellOf(live, "c1");
    const c2 = shellOf(live, "c2");
    const c3 = shellOf(live, "c3");
    assert.equal(c1, before.get("c1"), "an unchanged card keeps its DOM node");
    assert.equal(c2, before.get("c2"), "a moved card keeps its DOM node");
    assert.equal(c3, before.get("c3"), "a retitled card keeps its DOM node");
    assert.ok(c2.style.transform.includes("600px"), c2.style.transform);
    assert.equal(c3.querySelector(".pxd-item__header").textContent, "New title");
    for (const node of [c1, c2, c3]) assert.equal(node.classList.contains(SNAP_CLASS), false);
    assert.equal(shellOf(live, "c4"), null, "the deleted card is gone");
    const c5 = shellOf(live, "c5");
    assert.ok(c5, "the new card is built");
    assert.equal(before.has("c5"), false);
    assert.ok(c1.querySelector(".pxd-port"), "an adopted card gets its ports");
    assert.deepEqual(e.fake.writesLog(), [], "no write while painting or adopting");
    view.dispose();
    session.release?.();
  } finally {
    e.restore();
  }
});

test("a changed card drops its stale face; an unchanged card keeps it until its body mounts", async () => {
  const e = env({ eager: false });
  try {
    const first = e.mountOne();
    e.stub.flushFrames();
    e.stub.flushFrames();
    const snap = parseSnapshot(packSnapshot(captureBoardSnap({ ...first.view.snapshotSource(), uid: "b1" })));
    first.view.dispose();
    first.session.release?.();
    resetSessions();
    // Give the unchanged card a recognisable face body.
    const c1 = snap.items.find((item) => item.uid === "c1");
    const body = c1.face.k.find((kid) => typeof kid === "object" && String(kid.c).includes("pxd-item__body"));
    body.k = [{ t: "div", c: "pxd-snapface", k: ["Snapshot words"] }];
    const c3 = snap.items.find((item) => item.uid === "c3");
    const body3 = c3.face.k.find((kid) => typeof kid === "object" && String(kid.c).includes("pxd-item__body"));
    body3.k = [{ t: "div", c: "pxd-snapface", k: ["Old words"] }];
    await e.fake.api.data.block.update({ block: { uid: "c3", string: "Changed" } });
    await e.fake.flush?.();

    const mountEl = e.stub.document.createElement("div");
    e.stub.document.body.append(mountEl);
    const painted = paintBoardSnap(e.stub.document, mountEl, snap, { x: 0, y: 0, zoom: 1 });
    const session = acquireSession("b1", { host: e.host, raf: (fn) => fn() });
    const view = mountBoardView({
      host: e.host,
      session,
      mountEl,
      settings: { get: () => undefined },
      version: "test",
      initialViewport: { x: 0, y: 0, zoom: 1 },
      snapshot: { snap, shells: painted.shells },
    });
    e.stub.flushFrames();
    const live1 = shellOf(view.root, "c1");
    const live3 = shellOf(view.root, "c3");
    assert.ok(live1.querySelector(".pxd-snapface"), "the unchanged card shows its snapshot face");
    assert.equal(live1.classList.contains("pxd-item--bare"), false, "a faced card is not drawn as a grey skeleton");
    assert.equal(live3.querySelector(".pxd-snapface"), null, "a changed card never shows old words");
    e.stub.flushTimers();
    e.stub.flushIdle();
    e.stub.flushFrames();
    e.stub.flushIdle();
    assert.equal(live1.querySelector(".pxd-snapface"), null, "the live body replaces the face once it mounts");
    view.dispose();
    session.release?.();
  } finally {
    e.restore();
  }
});

test("PXD-7: the snapshot paints the board's own pattern, tone, hex colour and the Flat grey canvas", async () => {
  const cases = [
    { props: { v: 2, bg: "lines", bgColor: "#123456" }, settings: {}, grid: "pxd-grid--lines", bg: "#123456", cls: [] },
    { props: { v: 2, bg: "dots", bgColor: "teal" }, settings: {}, grid: "pxd-grid--dots", bg: "", cls: ["pxd-bg-teal"] },
    { props: { v: 2 }, settings: { "look-canvas": "flat-grey", grid: "lines" }, grid: "pxd-grid--plain", bg: "", cls: ["pxd-look--flat"] },
  ];
  for (const c of cases) {
    const stub = createDomStub();
    const restore = stub.install();
    try {
      const fake = createFakeRoam({ echoDelay: 0 });
      const host = createHost({ api: fake.api, storage: stub.localStorage, graph: "g" });
      fake.seedBoard({ uid: "b7", props: { plexus: c.props }, children: [{ uid: "c7", string: "Card", props: { plexus: { x: 0, y: 0, w: 200, h: 100 } } }] });
      const session = acquireSession("b7", { host, raf: (fn) => fn() });
      const mountEl = stub.document.createElement("div");
      stub.document.body.append(mountEl);
      const view = mountBoardView({ host, session, mountEl, settings: { get: (k) => c.settings[k] }, version: "test", initialViewport: { x: 0, y: 0, zoom: 1 } });
      stub.flushFrames();
      stub.flushFrames();
      const snap = parseSnapshot(packSnapshot(captureBoardSnap({ ...view.snapshotSource(), uid: "b7" })));
      view.dispose();
      session.release?.();
      resetSessions();
      const target = stub.document.createElement("div");
      stub.document.body.append(target);
      const painted = paintBoardSnap(stub.document, target, snap, { x: 0, y: 0, zoom: 1 });
      const grid = painted.root.querySelector(".pxd-grid");
      assert.ok(grid.classList.contains(c.grid), `${c.grid} on ${JSON.stringify(c.props)}`);
      if (c.grid !== "pxd-grid--plain") assert.match(grid.style.backgroundSize, /^[\d.]+px [\d.]+px$/);
      assert.equal(painted.root.style.backgroundColor || "", c.bg);
      for (const cls of c.cls) assert.ok(painted.root.classList.contains(cls), cls);
    } finally {
      restore();
    }
  }
});

test("PXD-7: a snapshot's root colour must be a plain colour", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const target = stub.document.createElement("div");
    stub.document.body.append(target);
    const snap = { v: 1, items: [], rootCls: "pxd-root", rootStyle: {}, grid: { c: "pxd-grid pxd-grid--dots", bg: "url(https://x.test/a.png)" } };
    const painted = paintBoardSnap(stub.document, target, snap, { x: 0, y: 0, zoom: 1 });
    assert.equal(painted.root.style.backgroundColor || "", "");
  } finally {
    restore();
  }
});
