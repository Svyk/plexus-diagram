// F5: "Fold sections in the outline" / "Unfold sections": :block/open on SECTION blocks only, one custom undo,
// gated on the collapse-outline setting.
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";

afterEach(() => resetSessions());

function open({ settings = null, sections = 5 } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const fake = createFakeRoam({ echoDelay: 0 });
  const secs = Array.from({ length: sections }, (_, i) => ({
    uid: `s${i}`,
    string: `Section ${i}`,
    props: { plexus: { type: "section", x: i * 500, y: 0, w: 480, h: 300 } },
    children: [
      { uid: `s${i}c`, string: `card ${i}`, props: { plexus: { x: 10, y: 40, w: 200, h: 100 } }, children: [{ uid: `s${i}k`, string: "kid" }] },
      ...(i === 0 ? [{ uid: "inner", string: "Inner", props: { plexus: { type: "section", x: 240, y: 40, w: 200, h: 200 } }, children: [{ uid: "innerc", string: "deep", props: { plexus: { x: 5, y: 40, w: 100, h: 60 } } }] }] : []),
    ],
  }));
  fake.seedBoard({
    uid: "b1",
    props: { plexus: { v: 2 } },
    children: [
      ...secs,
      { uid: "pg", string: "[[Some page]]", props: { plexus: { x: 0, y: 900, w: 300, h: 200 } }, children: [{ uid: "pgk", string: "page kid" }] },
      { uid: "inb", string: "{{[[diagram]]:Nested}}", props: { plexus: { x: 400, y: 900, w: 300, h: 200, v: 2 } }, children: [{ uid: "inbk", string: "inside" }] },
    ],
  });
  const host = createHost({ api: fake.api, storage: stub.localStorage, graph: "g" });
  const session = acquireSession("b1", { host, raf: (fn) => fn(), settings });
  return { fake, session, restore };
}
const openOf = (fake, uid) => fake.block(uid).open;

test("the plan names only section blocks, nested ones included, never page or board cards", () => {
  const { session, restore } = open();
  try {
    const plan = session.sectionFoldPlan(true);
    assert.deepEqual([...plan.uids].sort(), ["inner", "s0", "s1", "s2", "s3", "s4"]);
    assert.equal(plan.fold, true);
    assert.equal(plan.boardUid, "b1");
  } finally {
    restore();
  }
});

test("fold writes :block/open false on the sections only, and one Cmd+Z brings them all back", async () => {
  const { fake, session, restore } = open();
  try {
    const plan = session.sectionFoldPlan(true);
    const res = await session.foldSections(plan);
    assert.equal(res.changed, 6);
    for (const id of plan.uids) assert.equal(openOf(fake, id), false, id);
    assert.equal(openOf(fake, "pg"), true, "a page card is not folded");
    assert.equal(openOf(fake, "inb"), true, "a board card is not folded");
    assert.equal(openOf(fake, "s0c"), true, "cards inside sections are not folded");
    assert.equal(session.sectionFoldPlan(true).uids.length, 0, "a second run has nothing to do");
    fake.calls.length = 0;
    await session.undo();
    for (const id of plan.uids) assert.equal(openOf(fake, id), true, `${id} unfolded by one undo`);
    assert.equal(fake.calls.filter((c) => c[0] === "undo").length, 0, "no native Roam undo");
    await session.redo();
    for (const id of plan.uids) assert.equal(openOf(fake, id), false);
  } finally {
    restore();
  }
});

test("unfold opens the folded sections, again with one undo", async () => {
  const { fake, session, restore } = open();
  try {
    await session.foldSections(session.sectionFoldPlan(true));
    const plan = session.sectionFoldPlan(false);
    assert.equal(plan.uids.length, 6);
    const res = await session.foldSections(plan);
    assert.equal(res.changed, 6);
    for (const id of plan.uids) assert.equal(openOf(fake, id), true);
    await session.undo();
    for (const id of plan.uids) assert.equal(openOf(fake, id), false);
  } finally {
    restore();
  }
});

test("with the collapse-outline setting off the command refuses", async () => {
  const { fake, session, restore } = open({ settings: { get: (k) => (k === "collapse-outline" ? false : undefined) } });
  try {
    const plan = session.sectionFoldPlan(true);
    assert.equal(plan.refused, "setting");
    assert.deepEqual(plan.uids, []);
    const res = await session.foldSections(plan);
    assert.equal(res.changed, 0);
    assert.equal(openOf(fake, "s1"), true);
  } finally {
    restore();
  }
});

test("a stale plan only touches sections that still need it", async () => {
  const { fake, session, restore } = open();
  try {
    const plan = session.sectionFoldPlan(true);
    await session.foldSections({ ...plan, uids: ["s1"] });
    const res = await session.foldSections(plan);
    assert.equal(res.changed, 5);
    assert.equal(openOf(fake, "s1"), false);
  } finally {
    restore();
  }
});

test("the view command previews the count, folds on Apply and reports it", async () => {
  const { mountBoardView } = await import("../src/view/board-view.js");
  const stub = createDomStub({ width: 1400, height: 900 });
  const restore = stub.install();
  try {
    const fake = createFakeRoam({ echoDelay: 0 });
    fake.seedBoard({ uid: "b1", props: { plexus: { v: 2 } }, children: [
      { uid: "s0", string: "Alpha", props: { plexus: { type: "section", x: 0, y: 0, w: 400, h: 300 } }, children: [{ uid: "c0", string: "card", props: { plexus: { x: 10, y: 40, w: 100, h: 60 } } }] },
      { uid: "s1", string: "Beta", props: { plexus: { type: "section", x: 500, y: 0, w: 400, h: 300 } }, children: [] },
    ] });
    const host = createHost({ api: fake.api, storage: stub.localStorage, graph: "g" });
    const session = acquireSession("b1", { host, raf: (fn) => fn() });
    const mountEl = stub.document.createElement("div");
    mountEl.className = "pxd-mount";
    stub.document.body.append(mountEl);
    const view = mountBoardView({ host, session, mountEl, settings: { get: () => undefined }, version: "3.28.0" });
    const pending = view.foldSections(true);
    const dialog = view.root.querySelector(".pxd-pdf-pages");
    assert.ok(dialog, "a preview dialog");
    assert.match(dialog.textContent, /Fold 2 sections/);
    assert.equal(dialog.querySelectorAll("li").length, 2);
    const apply = dialog.querySelectorAll("button").find((b) => b.textContent === "Fold");
    apply.click();
    const res = await pending;
    assert.equal(res.changed, 2);
    assert.equal(fake.block("s0").open, false);
    assert.equal((await view.foldSections(true)).changed, 0, "nothing left to fold");
    view.dispose();
  } finally {
    restore();
  }
});

test("a fold dialog replaced by another command, or left open at dispose, settles its promise with null", async () => {
  const { mountBoardView } = await import("../src/view/board-view.js");
  const stub = createDomStub({ width: 1400, height: 900 });
  const restore = stub.install();
  try {
    const fake = createFakeRoam({ echoDelay: 0 });
    fake.seedBoard({ uid: "b1", props: { plexus: { v: 2 } }, children: [
      { uid: "s0", string: "Alpha", props: { plexus: { type: "section", x: 0, y: 0, w: 400, h: 300 } }, children: [] },
    ] });
    const host = createHost({ api: fake.api, storage: stub.localStorage, graph: "g" });
    const session = acquireSession("b1", { host, raf: (fn) => fn() });
    const mountEl = stub.document.createElement("div");
    mountEl.className = "pxd-mount";
    stub.document.body.append(mountEl);
    const view = mountBoardView({ host, session, mountEl, settings: { get: () => undefined }, version: "3.28.0" });
    const first = view.foldSections(true);
    assert.ok(view.root.querySelector(".pxd-pdf-pages"));
    const second = view.foldSections(true);
    assert.equal(await first, null, "the replaced dialog's promise settles");
    view.dispose();
    assert.equal(await second, null, "dispose settles the open dialog's promise");
  } finally {
    restore();
  }
});
