import assert from "node:assert/strict";
import test from "node:test";

import {
  COMMENTS_CONTAINER_STRING,
  commentAnchorString,
  commentBadgeCount,
  commentIndexFromRows,
  commentTargetUid,
  commentThreadPlan,
} from "../src/model/comments.js";
import { changedSince, createVisitStore, latestEdit, timeAgo } from "../src/model/changes.js";
import { installCommentHost } from "../src/host/comments.js";
import { createPanel } from "../src/view/panel.js";
import { buildMenu, flattenMenu } from "../src/view/menu-model.js";
import { createDomStub } from "./fixtures/dom-stub.js";

let uidN = 0;
const gen = () => `u${++uidN}`;

test("comment thread plan writes container, date, author, anchor in the verified Roam shape", () => {
  uidN = 0;
  const plan = commentThreadPlan({ children: [] }, { pageUid: "pg", targetUid: "RODZGpp7r", dateTitle: "October 11th, 2026", authorTitle: "Svy", generateUid: gen });
  assert.deepEqual(plan.ops.map((op) => [op.parentUid, op.string, op.order, op.open]), [
    ["pg", COMMENTS_CONTAINER_STRING, "last", false],
    ["u1", "[[October 11th, 2026]]", "first", undefined],
    ["u2", "[[Svy]]", "last", undefined],
    ["u3", "((RODZGpp7r))", "last", undefined],
  ]);
  assert.equal(plan.anchorUid, "u4");
  assert.equal(commentAnchorString("x"), "((x))");
});

test("comment thread plan reuses levels that already exist and throws on missing inputs", () => {
  uidN = 0;
  const tree = { children: [{ uid: "c", string: "[[roam/comments]]", order: 3, children: [
    { uid: "d", string: "[[October 11th, 2026]]", children: [{ uid: "a", string: "[[Svy]]", children: [] }] },
  ] }] };
  const plan = commentThreadPlan(tree, { pageUid: "pg", targetUid: "T", dateTitle: "October 11th, 2026", authorTitle: "Svy", generateUid: gen });
  assert.equal(plan.ops.length, 1);
  assert.deepEqual([plan.ops[0].parentUid, plan.ops[0].string], ["a", "((T))"]);
  assert.deepEqual(plan.existed, { container: true, date: true, author: true, anchor: false });
  assert.throws(() => commentThreadPlan(tree, { targetUid: "T", dateTitle: "d", authorTitle: "a", generateUid: gen }), /page/);
  assert.throws(() => commentThreadPlan(tree, { pageUid: "p", dateTitle: "d", authorTitle: "a", generateUid: gen }), /target/);
});

test("comment index sums per card, ordering threads and badge falls back to the legacy count", () => {
  const index = commentIndexFromRows([["card", "tB", 2], ["card", "tA", 1], ["card", "tA", 1], ["other", "tC", 4], ["", "x", 1]]);
  assert.equal(index.get("card").count, 3);
  assert.equal(index.get("card").threadUid, "tA");
  assert.equal(index.size, 2);
  assert.equal(commentBadgeCount(index.get("card"), 9), 3);
  assert.equal(commentBadgeCount(undefined, 2), 2);
  assert.equal(commentBadgeCount(undefined, 0), 0);
  assert.equal(commentTargetUid({ type: "card", uid: "c", target: { kind: "block", uid: "t" } }), "t");
  assert.equal(commentTargetUid({ type: "card", uid: "c", target: { kind: "page", title: "P" } }), null);
  assert.equal(commentTargetUid({ type: "section", uid: "s" }), null);
});

function fakeHost({ threadRows = [], commentsEid = 7, tree = null } = {}) {
  const writes = [];
  const opened = [];
  const queries = [];
  const host = {
    resolveEid: (ref) => (ref.title === "roam/comments" ? commentsEid : ref.uid === "gone" ? null : ref.uid.charCodeAt(0)),
    q: (query, ...inputs) => {
      queries.push(query);
      if (query.includes(":block/refs ?cp] [?anchor :block/uid ?au]")) return threadRows;
      if (query.includes("[?b :block/page ?p] [?p :block/uid ?pu]")) return [["pg"]];
      if (query.includes(":user/display-page")) return [["Svy"]];
      if (query.includes("[?c :block/refs ?cp] [?c :block/uid ?cu]")) return tree ? [["c"]] : [];
      return [];
    },
    cardStats: (targets) => new Map(targets.map((t) => [t.kind === "page" ? `page:${t.title}` : `uid:${t.uid}`, { refs: 1, boards: 0, open: 0, done: 0 }])),
    generateUid: gen,
    group: async (fn) => fn(),
    createBlock: async (b) => { writes.push(b); return b.uid || gen(); },
    openInSidebar: (uid, type) => opened.push([uid, type]),
  };
  const data = {
    pull: () => tree,
    pull_many: (pattern, eids) => eids.map((eid) => ({ ":db/id": eid, ":edit/time": 1000 * eid })),
  };
  const api = { data, user: { uid: () => "me" } };
  installCommentHost(host, { api, data, now: () => new Date(2026, 9, 11) });
  return { host, writes, opened, queries };
}

test("cardStats gains comment counts and the thread uid for block cards only", () => {
  const { host } = fakeHost({ threadRows: [["t1", "thr", 2]] });
  const res = host.cardStats([{ kind: "block", uid: "t1" }, { kind: "block", uid: "t2" }, { kind: "page", title: "P" }], {});
  assert.equal(res.get("uid:t1").comments, 2);
  assert.equal(res.get("uid:t1").commentThread, "thr");
  assert.equal(res.get("uid:t1").refs, 1);
  assert.equal(res.get("uid:t2").comments, undefined);
  assert.equal(res.get("page:P").comments, undefined);
});

test("a graph with no roam/comments page costs no thread query", () => {
  const { host, queries } = fakeHost({ commentsEid: null });
  const res = host.cardStats([{ kind: "block", uid: "t1" }], {});
  assert.equal(res.get("uid:t1").comments, undefined);
  assert.equal(queries.length, 0);
});

test("addComment creates the verified four-level structure and the body, then the thread opens", async () => {
  uidN = 0;
  const { host, writes, opened } = fakeHost();
  const out = await host.addComment("RODZGpp7r", "  looks good  ");
  assert.deepEqual(writes.map((w) => [w.parentUid, w.string, w.order, w.open]), [
    ["pg", "[[roam/comments]]", "last", false],
    [writes[0].uid, "[[October 11th, 2026]]", "first", undefined],
    [writes[1].uid, "[[Svy]]", "last", undefined],
    [writes[2].uid, "((RODZGpp7r))", "last", undefined],
    [writes[3].uid, "looks good", "last", undefined],
  ]);
  assert.equal(out.anchorUid, writes[3].uid);
  assert.equal(host.openCommentThread(out.anchorUid), true);
  assert.deepEqual(opened, [[out.anchorUid, "block"]]);
  assert.equal(await host.addComment("RODZGpp7r", "   "), null);
});

test("addComment adds to an existing thread without recreating levels", async () => {
  uidN = 0;
  const tree = {
    ":block/uid": "c", ":block/string": "[[roam/comments]]", ":block/order": 0,
    ":block/children": [{
      ":block/uid": "d", ":block/string": "[[October 11th, 2026]]",
      ":block/children": [{
        ":block/uid": "a", ":block/string": "[[Svy]]",
        ":block/children": [{ ":block/uid": "n", ":block/string": "((RODZGpp7r))", ":block/children": [{ ":block/uid": "b1", ":block/string": "first" }] }],
      }],
    }],
  };
  const { host, writes } = fakeHost({ tree });
  const out = await host.addComment("RODZGpp7r", "second");
  assert.equal(writes.length, 1);
  assert.deepEqual([writes[0].parentUid, writes[0].string], ["n", "second"]);
  assert.equal(out.anchorUid, "n");
});

test("editTimes pulls card blocks once and skips unknown uids", () => {
  const { host } = fakeHost();
  const nodes = host.editTimes(["a", "b", "gone", "a"]);
  assert.deepEqual([...nodes.keys()], ["a", "b"]);
  assert.equal(nodes.get("a")[":edit/time"], 97000);
});

const user = (name) => ({ ":user/display-name": name });

test("latest edit looks through descendants and names the user", () => {
  const node = {
    ":block/uid": "x", ":edit/time": 100, ":edit/user": user("Ann"),
    ":block/children": [{ ":edit/time": 300, ":edit/user": { ":user/display-page": { ":node/title": "Svy" } }, ":block/children": [{ ":edit/time": 200 }] }],
  };
  assert.deepEqual(latestEdit(node), { time: 300, user: "Svy" });
  assert.deepEqual(latestEdit([{ ":edit/time": 5 }, node]), { time: 300, user: "Svy" });
  assert.deepEqual(latestEdit({ ":create/time": 9 }), { time: 9, user: "" });
  assert.deepEqual(latestEdit(null), { time: 0, user: "" });
});

test("changedSince keeps only cards edited after the last visit, newest first", () => {
  const nodes = new Map([
    ["old", { ":edit/time": 50 }],
    ["mid", { ":edit/time": 150, ":edit/user": user("Ann") }],
    ["deep", { ":edit/time": 10, ":block/children": [{ ":edit/time": 400, ":edit/user": user("Bo") }] }],
    ["edge", { ":edit/time": 100 }],
  ]);
  const rows = changedSince(nodes, 100, (uid) => uid.toUpperCase());
  assert.deepEqual(rows.map((r) => [r.uid, r.time, r.user, r.title]), [["deep", 400, "Bo", "DEEP"], ["mid", 150, "Ann", "MID"]]);
  assert.deepEqual(changedSince(nodes, null), []);
});

test("time ago and the visit store round trip per board", () => {
  assert.equal(timeAgo(1000, 1000 + 30 * 1000), "just now");
  assert.equal(timeAgo(0, 5 * 60 * 1000), "5 min ago");
  assert.equal(timeAgo(0, 3 * 3600 * 1000), "3 h ago");
  assert.equal(timeAgo(0, 86400 * 1000), "1 day ago");
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const store = createVisitStore({ storage, graph: "g" });
  assert.equal(store.get("b1"), null);
  store.set("b1", 1234.9);
  assert.equal(store.get("b1"), 1234);
  assert.equal(store.get("b2"), null);
  assert.ok([...mem.keys()][0].startsWith("plexus-diagram:visit:g:"));
});

test("the Changed tab lists cards with who and when, and a click selects the card", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const root = stub.document.createElement("div");
    root.className = "pxd-root";
    stub.document.body.append(root);
    const picked = [];
    let loads = 0;
    let model = { on: true, hasBaseline: true, since: 1, rows: [
      { uid: "c1", title: "Alpha", user: "Ann", time: Date.now() - 5 * 60 * 1000 },
      { uid: "c2", title: "Beta", user: "", time: Date.now() - 3 * 3600 * 1000 },
    ] };
    const panel = createPanel({
      doc: stub.document, root, host: {}, timers: { later: () => () => {}, frame: () => () => {} },
      on: { listChanged: () => model, loadChanged: () => { loads++; }, selectChanged: (uid) => picked.push(uid) },
    });
    panel.open("changed");
    assert.equal(loads, 1);
    const rows = () => [...root.querySelectorAll(".pxd-changed__row")];
    assert.equal(root.querySelector(".pxd-panel__pane--changed .pxd-panel__empty").textContent, "Changed (2)");
    assert.deepEqual(rows().map((r) => r.dataset.changed), ["c1", "c2"]);
    assert.ok(root.querySelectorAll(".pxd-changed__meta").map((n) => n.textContent).join("|").includes("Ann, 5 min ago"));
    assert.ok(root.querySelectorAll(".pxd-changed__meta").map((n) => n.textContent).join("|").includes("3 h ago"));
    rows()[1].click();
    assert.deepEqual(picked, ["c2"]);
    model = { on: true, hasBaseline: false, rows: [] };
    panel.refreshChanged();
    assert.equal(rows().length, 0);
    model = { on: false, rows: [] };
    panel.refreshChanged();
    assert.match(root.querySelector(".pxd-panel__pane--changed .pxd-panel__empty").textContent, /board menu/);
  } finally {
    restore();
  }
});

test("menus offer Comment and Changed since last visit only when the host supports them", () => {
  const ids = (menu) => flattenMenu(menu).map((row) => row.id);
  assert.equal(ids(buildMenu("card", {})).includes("comment"), false);
  assert.equal(ids(buildMenu("card", { canComment: true })).includes("comment"), true);
  assert.equal(ids(buildMenu("board-menu", {})).includes("changed-since"), false);
  const on = flattenMenu(buildMenu("board-menu", { changes: true, changed: true })).find((row) => row.id === "changed-since");
  assert.equal(on.checked, true);
});
