// "Fold queries on this page": the plan (what Roam would render, outside boards), the caption text, the apply with
// one undo / redo against the fake Roam, and the open nudge gating.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  hasQueryMacro, plainQueryText, planQueryFolds, queryCaption, queryFoldLines, queryNudgeKey, shouldNudgeQueries,
  QUERY_CAPTION_MAX,
} from "../src/model/query-fold.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { createHost } from "../src/host/roam.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { buildBoard, worldRects } from "../src/model/board.js";
import { mountBoardView } from "../src/view/board-view.js";

afterEach(() => resetSessions());

const Q1 = "{{query: {and: [[TODO]] [[PhD/Cronobacter]]}}}";
const Q2 = "{{[[query]]: {and: #claim {or: [[A]] ((abc123XYZ))}}}}";

test("hasQueryMacro: both macro forms, nothing else", () => {
  assert.equal(hasQueryMacro(Q1), true);
  assert.equal(hasQueryMacro(Q2), true);
  assert.equal(hasQueryMacro("Open tasks {{query: {and: [[TODO]]}}}"), true);
  assert.equal(hasQueryMacro("{{[[table]]}}"), false);
  assert.equal(hasQueryMacro("a query about [[query]]"), false);
  assert.equal(hasQueryMacro(":q [:find ?b]"), false);
});

test("caption: wrapper removed, no [[ ]], #, (( )), :: or {{ }} left, at most 120 chars", () => {
  assert.equal(queryCaption(Q1), "Query · {and: TODO PhD/Cronobacter}");
  assert.equal(queryCaption(Q2), "Query · {and: claim {or: A abc123XYZ} }");
  assert.equal(plainQueryText("Status:: {{query: {and: #[[Lab Notebook]] [[x]]}}} tail"), "Status: {and: Lab Notebook x} tail");
  const long = queryCaption(`{{query: {and: ${Array.from({ length: 40 }, (_, i) => `[[Page ${i}]]`).join(" ")}}}}`);
  assert.ok(long.length <= QUERY_CAPTION_MAX);
  assert.ok(long.endsWith("…"));
  for (const s of [Q1, Q2, "{{query: {and: [[a [[b]]]] {{embed: ((x))}}}}}"]) {
    const c = queryCaption(s);
    assert.doesNotMatch(c, /\[\[|\]\]|\(\(|\)\)|#|::|\{\{|\}\}/, c);
  }
  assert.equal(queryCaption("{{query: }}"), "Query");
});

// A page as a nested outline; kidsOfMany reads one level of it per call (the host does one pull_many per level).
function outline(tree) {
  const kids = new Map();
  const walk = (parent, list) => {
    kids.set(parent, list.map((n, i) => ({ uid: n.uid, string: n.string || "", open: n.open !== false, order: i })));
    for (const n of list) walk(n.uid, n.children || []);
  };
  walk(tree.uid, tree.children);
  const calls = [];
  return {
    calls,
    kidsOfMany: (ids) => { calls.push(ids.slice()); return new Map(ids.map((id) => [id, kids.get(id) || []])); },
  };
}

test("plan: open queries at any depth; not under a folded block, not inside any diagram, not below a query", () => {
  const page = {
    uid: "pg",
    children: [
      { uid: "board", string: "{{[[diagram]]:Main}}", open: false, children: [{ uid: "qcard", string: Q1 }] },
      { uid: "board2", string: "{{diagram}}", children: [{ uid: "qcard2", string: Q1 }] },
      { uid: "q1", string: Q1, children: [{ uid: "qkid", string: Q2 }] },
      { uid: "folded", string: "notes", open: false, children: [{ uid: "qhidden", string: Q1 }] },
      { uid: "open", string: "work", children: [{ uid: "deep", string: "deeper", children: [{ uid: "q3", string: Q2 }] }, { uid: "q2", string: "Tasks {{query: {and: [[TODO]]}}}" }] },
      { uid: "qfolded", string: Q2, open: false, children: [{ uid: "x", string: "y" }] },
    ],
  };
  const o = outline(page);
  let n = 0;
  const plan = planQueryFolds({ pageUid: "pg", boardUid: "board", graph: "g", kidsOfMany: o.kidsOfMany, newUid: () => `cap${++n}` });
  assert.deepEqual(plan.folds.map((f) => f.queryUid), ["q1", "qfolded", "q2", "q3"]);
  const q2 = plan.folds.find((f) => f.queryUid === "q2");
  assert.equal(q2.parentUid, "open");
  assert.equal(q2.order, 1);
  assert.equal(q2.caption, "Query · Tasks {and: TODO}");
  assert.equal(plan.folds[0].parentUid, "pg");
  assert.equal(plan.folds[0].order, 2);
  assert.equal(plan.truncated, false);
  // One read per open level, never into a board or a folded block.
  assert.deepEqual(o.calls, [["pg"], ["open"], ["deep"]]);
  assert.deepEqual(queryFoldLines(plan, 2), [plan.folds[0].caption, plan.folds[1].caption, "and 2 more"]);
  const capped = planQueryFolds({ pageUid: "pg", kidsOfMany: o.kidsOfMany, newUid: () => "c", limit: 3 });
  assert.equal(capped.truncated, true);
});

test("nudge: only when Roam held the first paint 1.5 s or more, never in the sidebar, once per page", () => {
  assert.equal(shouldNudgeQueries({ entry: { kind: "main", firstPaintMs: 8600, paintTaskMs: 10 } }), true);
  assert.equal(shouldNudgeQueries({ entry: { kind: "main", firstPaintMs: 1400, paintTaskMs: 10 } }), false);
  assert.equal(shouldNudgeQueries({ entry: { kind: "sidebar", firstPaintMs: 8600, paintTaskMs: 10 } }), false);
  assert.equal(shouldNudgeQueries({ entry: { kind: "main", firstPaintMs: 8600, paintTaskMs: 10 }, seen: true }), false);
  assert.equal(shouldNudgeQueries({}), false);
  assert.equal(queryNudgeKey("g", "pg"), "plexus-diagram:query-nudge:g:pg");
});

function seeded() {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  host.graphName = () => "g";
  host.blockPageUid = () => "pg";
  fake.seedPage({
    title: "Main",
    uid: "pg",
    children: [
      { uid: "intro", string: "intro" },
      { uid: "q1", string: Q1 },
      { uid: "mid", string: "mid", children: [{ uid: "m0", string: "m0" }, { uid: "q2", string: Q2, children: [{ uid: "q2k", string: "kid" }] }, { uid: "m2", string: "m2" }] },
      { uid: "q3", string: "{{query: {and: [[x]]}}}" },
    ],
  });
  fake.seedBoard({
    uid: "b1",
    parent: "pg",
    props: { plexus: { v: 2 } },
    children: [{ uid: "card", string: Q1, props: { plexus: { type: "card", x: 0, y: 0 } } }],
  });
  const session = acquireSession("b1", { host, raf: (fn) => fn(), linkDelay: 0, settings: { "graph-links": "off" } });
  return { fake, host, session };
}

test("apply: a folded caption in each query's place, the query under it; board query cards untouched; second run plans nothing", async () => {
  const { fake, session } = seeded();
  const plan = session.queryFoldPlan();
  assert.deepEqual(plan.folds.map((f) => f.queryUid), ["q1", "q3", "q2"]);
  fake.clearLog();
  const res = await session.foldPageQueries(plan);
  assert.equal(res.folded, 3);
  const [c1, c3, c2] = plan.folds.map((f) => f.captionUid);
  assert.deepEqual(fake.children("pg"), ["intro", c1, "mid", c3, "b1"]);
  assert.deepEqual(fake.children("mid"), ["m0", c2, "m2"]);
  assert.deepEqual(fake.children(c1), ["q1"]);
  assert.deepEqual(fake.children(c2), ["q2"]);
  assert.deepEqual(fake.children("q2"), ["q2k"]);
  assert.equal(fake.block(c1).open, false);
  assert.equal(fake.block(c1).string, "Query · {and: TODO PhD/Cronobacter}");
  assert.equal(fake.block("card").parent, "b1");
  assert.equal(session.queryFoldPlan().folds.length, 0);
  fake.clearLog();
  assert.deepEqual(await session.foldPageQueries(plan), { folded: 0 });
  assert.equal(fake.writesLog().length, 0);
});

test("apply: refuses another board or graph, skips a query that moved since the plan", async () => {
  const { fake, session } = seeded();
  const plan = session.queryFoldPlan();
  fake.clearLog();
  assert.deepEqual(await session.foldPageQueries({ ...plan, boardUid: "b2" }), { folded: 0, refused: "board" });
  assert.deepEqual(await session.foldPageQueries({ ...plan, graph: "other" }), { folded: 0, refused: "graph" });
  assert.equal(fake.writesLog().length, 0);
  await fake.api.data.block.move({ location: { "parent-uid": "intro", order: 0 }, block: { uid: "q1" } });
  const res = await session.foldPageQueries(plan);
  assert.equal(res.folded, 2);
  assert.equal(fake.block("q1").parent, "intro");
});

test("undo: one undo restores the page exactly (captions gone, queries back in place); redo folds again", async () => {
  const { fake, session } = seeded();
  fake.trackUndo = true;
  const snap = () => ({ pg: fake.children("pg"), mid: fake.children("mid"), q2: fake.children("q2") });
  const before = snap();
  const plan = session.queryFoldPlan();
  await session.foldPageQueries(plan);
  const after = snap();
  assert.notDeepEqual(after, before);
  await session.undo();
  assert.deepEqual(snap(), before);
  assert.ok(plan.folds.every((f) => !fake.has(f.captionUid)), "every caption is gone");
  await session.redo();
  assert.deepEqual(snap(), after);
  assert.deepEqual(fake.children(plan.folds[0].captionUid), ["q1"]);
  await session.undo();
  assert.deepEqual(snap(), before);
});

test("undo: an unreadable query location never deletes a caption that still holds its query", { timeout: 20000 }, async () => {
  const { fake, host, session } = seeded();
  fake.trackUndo = true;
  const plan = session.queryFoldPlan();
  await session.foldPageQueries(plan);
  const [c1] = plan.folds.map((f) => f.captionUid);
  // The move back of q1 has not landed and its location read fails.
  const move = fake.api.data.block.move;
  fake.api.data.block.move = (args) => (args?.block?.uid === "q1" ? Promise.resolve() : move(args));
  const loc = host.blockLocation;
  host.blockLocation = (u) => (u === "q1" ? null : loc.call(host, u));
  await session.undo();
  fake.api.data.block.move = move;
  host.blockLocation = loc;
  assert.ok(fake.has("q1"), "the query survives");
  assert.ok(fake.has(c1), "its caption is left");
  assert.deepEqual(fake.children(c1), ["q1"]);
  assert.equal(fake.block("q1").parent, c1);
});

test("undo: a null location read still deletes the caption once its children prove the query left", async () => {
  const { fake, host, session } = seeded();
  fake.trackUndo = true;
  const before = { pg: fake.children("pg"), mid: fake.children("mid") };
  const plan = session.queryFoldPlan();
  await session.foldPageQueries(plan);
  const loc = host.blockLocation;
  host.blockLocation = () => null;
  await session.undo();
  host.blockLocation = loc;
  assert.deepEqual({ pg: fake.children("pg"), mid: fake.children("mid") }, before);
  assert.ok(plan.folds.every((f) => !fake.has(f.captionUid)));
});

test("bulk: a plan over the refuse line writes nothing", async () => {
  const { fake, session } = seeded();
  const plan = session.queryFoldPlan();
  const many = { ...plan, folds: Array.from({ length: 1600 }, (_, i) => ({ ...plan.folds[0], captionUid: `c${i}` })) };
  fake.clearLog();
  const res = await session.foldPageQueries(many);
  assert.equal(res.refused, "bulk");
  assert.equal(fake.writesLog().length, 0);
});

test("view nudge: one toast per page per device with a Fold them action; never for the sidebar or a quick open", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const board = buildBoard({ ":block/uid": "b1", ":block/string": "{{[[diagram]]}}", ":block/props": { ":plexus": { ":v": 2 } }, ":block/children": [] });
    let plans = 0;
    const session = {
      uid: "b1", board, rects: worldRects(board), links: [], coveredEdges: new Set(), busy: false,
      on() { return () => {}; }, emit() {}, handlerCount: () => 0, release() {}, setLinkMode() {},
      undo: () => Promise.resolve(), redo: () => Promise.resolve(),
      queryFoldPlan: () => { plans += 1; return { boardUid: "b1", folds: [{ queryUid: "q", captionUid: "c", caption: "Query · x" }, { queryUid: "q2", captionUid: "c2", caption: "Query · y" }] }; },
      foldPageQueries: () => Promise.resolve({ folded: 2 }),
    };
    const host = {
      graph: "g", renderString() {}, renderBlock() {}, renderPage() {}, unmount() {}, blockString: () => null, pullTree: () => [],
      pagePreview: () => ({ exists: false, blocks: [] }), openBlock() {}, openInSidebar() {}, blockPageUid: () => "pg",
    };
    const mountEl = stub.document.createElement("div");
    stub.document.body.append(mountEl);
    const view = mountBoardView({ host, session, mountEl, settings: { get: () => undefined }, version: "1.0.0" });
    assert.equal(view.queryNudge({ kind: "sidebar", firstPaintMs: 9000, paintTaskMs: 10 }), false);
    assert.equal(view.queryNudge({ kind: "main", firstPaintMs: 900, paintTaskMs: 10 }), false);
    assert.equal(plans, 0, "no page walk unless the open was held");
    assert.equal(view.queryNudge({ kind: "main", firstPaintMs: 8610, paintTaskMs: 10 }), true);
    const toastEl = view.root.querySelector(".pxd-toast");
    assert.match(toastEl.textContent, /Roam took 8\.6 s to draw 2 queries on this page before the board could show\./);
    assert.ok(toastEl.textContent.includes("Fold them"));
    assert.equal(view.queryNudge({ kind: "main", firstPaintMs: 8610, paintTaskMs: 10 }), false, "once per page per device");
    assert.equal(plans, 1);
    view.dispose();
  } finally {
    restore();
  }
});
