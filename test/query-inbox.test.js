import assert from "node:assert/strict";
import test from "node:test";

import { createDomStub } from "./fixtures/dom-stub.js";
import {
  QUERY_RESULT_CAP,
  QUERY_SHOW,
  createQueryCache,
  loadQueryRows,
  parseQuery,
  queryLeaves,
  queryRow,
  rankUids,
  rowDragPayload,
  runQuery,
  visibleRows,
} from "../src/model/query-run.js";
import { DIRECT_CAP, WIDE_LIMIT, createQueryBackend } from "../src/host/query-backend.js";
import { createQueryCards } from "../src/view/query-card.js";
import { CARD_MIME } from "../src/model/drop.js";
import { INBOX_CAP, filterInbox, inboxEntries, inboxPlan, inboxRow, inboxTitles, readInbox } from "../src/model/inbox.js";
import { createInbox } from "../src/view/inbox.js";
import { BOARD_MEMBER_RULE, createBoardRules, installBoardRules } from "../src/model/board-rule.js";

const NOON = new Date(2026, 9, 11, 12).getTime();
const flush = () => new Promise((resolve) => setImmediate(resolve));
const U = (n) => `uid${String(n).padStart(6, "0")}`;

test("QI-1: and, or, not, tags, block refs and a title translate", () => {
  const p = parseQuery('{{[[query]]: "Open work" {and: [[Project]] #todo #[[Big Idea]] ((abcdefghi)) {not: [[Archived]]} {or: [[A]] [[B [[C]]]]}}}}', { now: NOON });
  assert.equal(p.ok, true);
  assert.equal(p.title, "Open work");
  assert.equal(p.ast.op, "and");
  assert.deepEqual(p.ast.args.map((a) => a.op), ["page", "page", "page", "block", "not", "or"]);
  assert.equal(p.ast.args[1].title, "todo");
  assert.equal(p.ast.args[2].title, "Big Idea");
  assert.equal(p.ast.args[5].args[1].title, "B [[C]]");
  assert.deepEqual(queryLeaves(p.ast).map((l) => l.title || l.uid).slice(0, 4), ["Project", "todo", "Big Idea", "abcdefghi"]);
});

test("QI-1: the {{query: ...}} form and bare clauses mean and; TODO and DONE are plain page refs", () => {
  const p = parseQuery("{{query: [[TODO]] [[Plexus]]}}");
  assert.equal(p.ok, true);
  assert.equal(p.ast.op, "and");
  assert.deepEqual(p.ast.args.map((a) => a.title), ["TODO", "Plexus"]);
  assert.equal(parseQuery("{{[[query]]: [[DONE]]}}").ast.op, "page");
});

test("QI-1: between expands to daily pages; long ranges and relative words fall back", () => {
  const p = parseQuery("{{[[query]]: {and: [[TODO]] {between: [[October 9th, 2026]] [[October 11th, 2026]]}}}}", { now: NOON });
  assert.equal(p.ok, true);
  const between = p.ast.args[1];
  assert.deepEqual(between.args.map((a) => a.title), ["October 9th, 2026", "October 10th, 2026", "October 11th, 2026"]);
  const rel = parseQuery("{{[[query]]: {between: [[yesterday]] [[today]]}}}", { now: NOON });
  assert.equal(rel.ok, true);
  assert.deepEqual(rel.ast.args.map((a) => a.title), ["October 10th, 2026", "October 11th, 2026"]);
  assert.equal(parseQuery("{{[[query]]: {between: [[January 1st, 2026]] [[October 11th, 2026]]}}}", { now: NOON }).ok, false);
  assert.equal(parseQuery("{{[[query]]: {between: [[last week]] [[today]]}}}", { now: NOON }).ok, false);
  assert.equal(parseQuery("{{[[query]]: {and: [[Project]] [[today]]}}}", { now: NOON }).ok, false);
});

test("QI-1: what Plexus cannot translate stays with Roam", () => {
  for (const s of [
    "{{[[query]]: {search: budget}}}",
    "{{[[query]]: {and: [[A]] {by: Svyat}}}}",
    "{{[[query]]: {and: [[A]] {daily-notes:}}}}",
    "{{[[query]]: {not: [[A]]}}}",
    "{{[[query]]: {and: {not: [[A]]}}}}",
    "{{[[query]]: {or: [[A]] {not: [[B]]}}}}",
    "{{[[query]]: {and: [[A]] bareword}}}",
    "{{[[query]]: {and: [[A]]}}",
    "{{[[query]]}}",
    "{{[[diagram]]: Flow}}",
    "plain text",
  ]) assert.equal(parseQuery(s).ok, false, s);
});

function fakeBackend(sets, { partial = [] } = {}) {
  const calls = [];
  return {
    calls,
    hits: async (leaf) => {
      const key = leaf.title || leaf.uid;
      calls.push(key);
      return { uids: sets[key] || [], partial: partial.includes(key) };
    },
  };
}

test("QI-2: and intersects, or unions, not subtracts, and each leaf is read once", async () => {
  const sets = { A: ["a", "b", "c"], B: ["b", "c", "d"], C: ["c"], D: ["x"] };
  const be = fakeBackend(sets);
  const ast = parseQuery("{{[[query]]: {and: [[A]] [[B]] {not: [[C]]}}}}").ast;
  const run = await runQuery(ast, be, { tick: async () => {} });
  assert.equal(run.status, "ok");
  assert.deepEqual(run.uids, ["b"]);
  const or = await runQuery(parseQuery("{{[[query]]: {or: [[C]] [[D]] [[C]]}}}").ast, fakeBackend(sets), { tick: async () => {} });
  assert.deepEqual(or.uids.sort(), ["c", "x"]);
  const be2 = fakeBackend(sets);
  await runQuery(parseQuery("{{[[query]]: {and: [[A]] {or: [[A]] [[B]]}}}}").ast, be2, { tick: async () => {} });
  assert.deepEqual(be2.calls, ["A", "B"]);
});

test("QI-2: partial leaves mark the run; a slow or failing backend returns a status, not rows", async () => {
  const ast = parseQuery("{{[[query]]: {and: [[A]] [[B]]}}}").ast;
  const part = await runQuery(ast, fakeBackend({ A: ["a"], B: ["a"] }, { partial: ["B"] }), { tick: async () => {} });
  assert.equal(part.partial, true);
  let t = 0;
  const slow = await runQuery(ast, fakeBackend({ A: ["a"], B: ["a"] }), { tick: async () => {}, clock: () => (t += 3000), budgetMs: 4000 });
  assert.equal(slow.status, "slow");
  assert.deepEqual(slow.uids, []);
  const boom = await runQuery(ast, { hits: async () => { throw new Error("5 s"); } }, { tick: async () => {} });
  assert.equal(boom.status, "error");
  const gone = await runQuery(ast, fakeBackend({}), { tick: async () => {}, isCancelled: () => true });
  assert.equal(gone.status, "cancelled");
  assert.equal((await runQuery(null, fakeBackend({}))).status, "unsupported");
});

test("QI-3: rows rank newest first, cap at 200, show 30, and carry a drag payload", async () => {
  const uids = Array.from({ length: 260 }, (_, i) => U(i));
  const times = new Map(uids.map((u, i) => [u, i]));
  const backend = {
    hits: async () => ({ uids, partial: false }),
    times: () => times,
    details: (order) => order.map((uid) => ({ uid, string: `Block ${uid}\nsecond line`, page: "Lab notes", parent: "Parent **bold** text", time: times.get(uid) })),
  };
  const ast = parseQuery("{{[[query]]: [[Lab]]}}").ast;
  const got = await loadQueryRows(ast, backend, { tick: async () => {} });
  assert.equal(got.status, "ok");
  assert.equal(got.rows.length, QUERY_RESULT_CAP);
  assert.equal(got.total, 260);
  assert.equal(got.partial, true);
  assert.equal(got.rows[0].uid, U(259));
  assert.equal(got.rows[0].text, `Block ${U(259)}`);
  assert.equal(got.rows[0].crumb, "Lab notes › Parent bold text");
  assert.equal(rowDragPayload(got.rows[0]), `((${U(259)}))`);
  const v = visibleRows(got.rows);
  assert.equal(v.rows.length, QUERY_SHOW);
  assert.equal(v.hidden, QUERY_RESULT_CAP - QUERY_SHOW);
  assert.deepEqual(rankUids(["a", "b", "c"], new Map([["a", 1], ["b", 3], ["c", 2]]), 2), ["b", "c"]);
});

test("QI-3: a page result is a [[page]] drag, and the cache keeps 30 rows per card", () => {
  const page = queryRow({ uid: "pageUID01", title: "Big Idea", string: "" });
  assert.equal(page.kind, "page");
  assert.equal(rowDragPayload(page), "[[Big Idea]]");
  assert.equal(queryRow({ uid: "blkUID001", string: "" }).text, "(empty block)");
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const cache = createQueryCache(storage, "G");
  assert.equal(cache.get("q1"), null);
  cache.set("q1", Array.from({ length: 80 }, (_, i) => queryRow({ uid: U(i), string: `r${i}` })), { total: 80, partial: false });
  const back = cache.get("q1");
  assert.equal(back.rows.length, QUERY_SHOW);
  assert.equal(back.total, 80);
  assert.ok([...store.keys()][0].startsWith("plexus-diagram:qc:G:"));
  assert.equal(createQueryCache({ getItem() { throw new Error("private"); } }).get("x"), null);
});

test("QI-4: the backend reads each leaf with bounded q calls and skips the wide steps on a hot page", () => {
  const seen = [];
  let count = 40;
  const host = {
    q(query, ...inputs) {
      seen.push([query, inputs]);
      if (query.includes("(count ?r)")) return [[count]];
      if (query.includes("(count ?b)")) return [[10]];
      if (query.includes(":block/parents ?r")) return [["kid00001"]];
      if (query.includes(":block/page ?p] [?b :block/uid ?u]")) return [["onpage001"]];
      return [["ref000001"], ["ref000002"]];
    },
  };
  const be = createQueryBackend(host);
  const small = be.hits({ op: "page", title: "Lab" });
  assert.deepEqual(small.uids.sort(), ["kid00001", "onpage001", "ref000001", "ref000002"]);
  assert.equal(small.partial, false);
  assert.ok(seen.every(([, inputs]) => inputs[0] === "Lab"));
  assert.ok(seen.some(([query]) => query.includes(":node/title ?k")));
  seen.length = 0;
  const byUid = be.hits({ op: "block", uid: "abcdefghi" });
  assert.ok(seen.every(([query]) => query.includes(":block/uid ?k")));
  assert.ok(!seen.some(([query]) => query.includes(":block/page ?p]")));
  assert.equal(byUid.partial, false);
  count = WIDE_LIMIT + 1;
  seen.length = 0;
  const hot = be.hits({ op: "page", title: "TODO" });
  assert.equal(hot.partial, true);
  assert.ok(!seen.some(([query]) => query.includes(":block/parents ?r")));
  count = DIRECT_CAP + 1;
  assert.deepEqual(be.hits({ op: "page", title: "TODO" }), { uids: [], partial: true });
});

test("QI-4: times and details run in chunks of the uids they are given", () => {
  const calls = [];
  const host = {
    q(query, uids) {
      calls.push(uids.length);
      if (query.includes("get-else $ ?b :edit/time 0) ?t]]")) return uids.map((u, i) => [u, i]);
      if (query.includes(":block/string \"\"")) return uids.map((u) => [u, `s ${u}`, "", 5]);
      return [];
    },
  };
  const be = createQueryBackend(host);
  const uids = Array.from({ length: 450 }, (_, i) => U(i));
  assert.equal(be.times(uids).size, 450);
  assert.deepEqual(calls, [200, 200, 50]);
  calls.length = 0;
  assert.equal(be.details(uids.slice(0, 120)).length, 120);
  assert.ok(Math.max(...calls) <= 50);
});

function mountCard({ string, backend, storage, hostExtra = {} }) {
  const dom = createDomStub();
  const parent = dom.document.createElement("div");
  dom.document.body.append(parent);
  const cards = createQueryCards({
    doc: dom.document,
    host: { q: () => [], ...hostExtra },
    storage,
    graph: "G",
    backend,
    schedule: (fn) => setImmediate(fn),
  });
  const root = cards.mount(parent, "queryUID1", string);
  return { dom, parent, cards, root };
}

test("QI-5: a translatable query paints after mount, and a row drags out as a ((uid)) card", async () => {
  const backend = {
    hits: async () => ({ uids: ["aaaaaaaa1", "aaaaaaaa2"], partial: false }),
    times: () => new Map([["aaaaaaaa1", 1], ["aaaaaaaa2", 2]]),
    details: (order) => order.map((uid) => ({ uid, string: `text ${uid}`, page: "Lab" })),
  };
  const { root } = mountCard({ string: "{{[[query]]: [[Lab]]}}", backend });
  assert.ok(root);
  assert.equal(root.querySelectorAll(".pxd-qc__row").length, 0);
  assert.match(root.querySelector(".pxd-qc__empty").textContent, /Running/);
  await flush(); await flush(); await flush(); await flush();
  const rows = root.querySelectorAll(".pxd-qc__row");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].dataset.uid, "aaaaaaaa2");
  assert.match(root.querySelector(".pxd-qc__count").textContent, /2 results/);
  const set = {};
  rows[0].dispatchEvent({ type: "dragstart", dataTransfer: { setData: (k, v) => { set[k] = v; } } });
  assert.equal(set[CARD_MIME], "((aaaaaaaa2))");
  assert.equal(set["text/plain"], "((aaaaaaaa2))");
});

test("QI-5: Show more reveals the next 30 and the refresh button runs the query again", async () => {
  let runs = 0;
  const uids = Array.from({ length: 70 }, (_, i) => U(i));
  const backend = {
    hits: async () => { runs += 1; return { uids, partial: false }; },
    times: () => new Map(uids.map((u, i) => [u, i])),
    details: (order) => order.map((uid) => ({ uid, string: uid })),
  };
  const { root } = mountCard({ string: "{{[[query]]: [[Lab]]}}", backend });
  for (let i = 0; i < 6; i += 1) await flush();
  assert.equal(root.querySelectorAll(".pxd-qc__row").length, 30);
  const more = root.querySelector(".pxd-qc__more");
  assert.equal(more.hidden, false);
  more.click();
  assert.equal(root.querySelectorAll(".pxd-qc__row").length, 60);
  assert.equal(runs, 1);
  root.querySelector(".pxd-qc__refresh").click();
  for (let i = 0; i < 6; i += 1) await flush();
  assert.equal(runs, 2);
});

test("QI-5: an untranslatable query returns null so Roam keeps rendering it, and a failed run shows the last rows", async () => {
  const backend = { hits: async () => { throw new Error("timeout"); }, times: () => new Map(), details: () => [] };
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const first = mountCard({ string: "{{[[query]]: {search: x}}}", backend, storage });
  assert.equal(first.root, null);
  createQueryCache(storage, "G").set("queryUID1", [queryRow({ uid: "cached001", string: "kept row" })], { total: 1 });
  const second = mountCard({ string: "{{[[query]]: [[Lab]]}}", backend, storage });
  assert.equal(second.root.querySelectorAll(".pxd-qc__row").length, 1);
  for (let i = 0; i < 6; i += 1) await flush();
  assert.equal(second.root.querySelectorAll(".pxd-qc__row")[0].querySelector(".pxd-qc__text").textContent, "kept row");
  assert.match(second.root.querySelector(".pxd-qc__count").textContent, /last run/);
});

test("QI-5: the fallback keeps the uids Roam rendered, and shows them when the render fails", async () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const backend = { details: (order) => order.map((uid) => ({ uid, string: `row ${uid}` })) };
  const dom = createDomStub();
  const card = dom.document.createElement("div");
  const live = dom.document.createElement("div");
  card.append(live);
  dom.document.body.append(card);
  const result = dom.document.createElement("div");
  result.setAttribute("id", "block-input-db-body-outline-xxnGb6SEj-SQo1XCFLi");
  live.append(result);
  const cards = createQueryCards({ doc: dom.document, host: {}, storage, graph: "G", backend, schedule: (fn) => setImmediate(fn) });
  cards.watchFallback(card, live, "queryUID1");
  await flush(); await flush();
  assert.equal(cards.cache.get("queryUID1").rows[0].uid, "SQo1XCFLi");
  const bare = dom.document.createElement("div");
  const liveBare = dom.document.createElement("div");
  bare.append(liveBare);
  dom.document.body.append(bare);
  cards.watchFallback(bare, liveBare, "queryUID1");
  await flush(); await flush();
  assert.equal(bare.querySelectorAll(".pxd-qc__row").length, 1);
});

test("QI-6: inbox titles are the page title and the board title, deduped, never Untitled board", () => {
  assert.deepEqual(inboxTitles({ pageTitle: "Lab", boardTitle: "Flow" }), ["Lab", "Flow"]);
  assert.deepEqual(inboxTitles({ pageTitle: "Flow", boardTitle: "Flow" }), ["Flow"]);
  assert.deepEqual(inboxTitles({ pageTitle: "", boardTitle: "Untitled board" }), []);
});

test("QI-6: the planner is one reverse pull per title, capped, never a scan", () => {
  const plan = inboxPlan(["Lab", "Flow"]);
  assert.equal(plan.length, 2);
  assert.deepEqual(plan[0].inputs, ["Lab"]);
  assert.match(plan[0].query, /\(limit :block\/_refs 1000\)/);
  assert.match(plan[0].query, /:node\/title \?t\]/);
  assert.doesNotMatch(plan[0].query, /\[\?b :block\/string/);
});

const pulled = (refs) => [[{ title: "Lab", _refs: refs }]];
const ref = (uid, page, time, string = `note ${uid}`) => ({ uid, string, time, page: { title: page } });

test("QI-6: a fake host feeds daily blocks only, newest first, minus what is on the board", async () => {
  const seen = [];
  const q = (query, ...inputs) => {
    seen.push(inputs[0]);
    if (inputs[0] === "Lab") {
      return pulled([
        ref("old000001", "October 2nd, 2026", 100),
        ref("new000001", "October 9th, 2026", 300),
        ref("mid000001", "October 5th, 2026", 200),
        ref("page00001", "Lab notes", 400),
        ref("onboard01", "October 6th, 2026", 250),
        ref("boardself", "October 7th, 2026", 260),
      ]);
    }
    return [[{ ":node/title": "Flow", ":block/_refs": [{ ":block/uid": "new000001", ":block/string": "dup", ":create/time": 300, ":block/page": { ":node/title": "October 9th, 2026" } }, { ":block/uid": "ns0000001", ":block/string": "namespaced", ":create/time": 500, ":block/page": [{ ":node/title": "October 10th, 2026" }] }] }]];
  };
  const got = await readInbox(q, ["Lab", "Flow"]);
  assert.deepEqual(seen, ["Lab", "Flow"]);
  const list = filterInbox(got.entries, { onBoard: new Set(["onboard01"]), skip: new Set(["boardself"]) });
  assert.deepEqual(list.map((e) => e.uid), ["ns0000001", "new000001", "mid000001", "old000001"]);
  assert.deepEqual(inboxRow(list[0]), { uid: "ns0000001", text: "namespaced", page: "October 10th, 2026", string: "((ns0000001))", time: 500 });
});

test("QI-6: the inbox caps at 100 and a full pull is reported", () => {
  const refs = Array.from({ length: 1000 }, (_, i) => ref(U(i), "October 3rd, 2026", i));
  const got = inboxEntries(pulled(refs));
  assert.equal(got.full, true);
  assert.equal(filterInbox(got.entries).length, INBOX_CAP);
  assert.equal(inboxEntries([]).entries.length, 0);
  assert.equal(inboxEntries(null).full, false);
});

function mountInbox({ onBoard = new Set(), pull }) {
  const dom = createDomStub();
  const root = dom.document.createElement("div");
  dom.document.body.append(root);
  const placed = [];
  const queue = [];
  const timers = { idle: (fn) => { const id = setImmediate(fn); return () => clearImmediate(id); } };
  const ctl = createInbox({
    doc: dom.document,
    root,
    host: { q: () => pull },
    timers,
    titles: () => ["Lab", "Flow"],
    onBoard: () => onBoard,
    skip: () => new Set(),
    place: (strings) => { placed.push(strings); for (const s of strings) onBoard.add(s.slice(2, -2)); },
  });
  return { dom, root, ctl, placed, queue };
}

test("QI-7: the pill shows Inbox (N) after the idle read; Place adds a card and the row leaves", async () => {
  const { root, ctl, placed } = mountInbox({
    pull: pulled([ref("new000001", "October 9th, 2026", 300, "Idea for the board"), ref("old000001", "October 2nd, 2026", 100)]),
  });
  assert.equal(root.querySelector(".pxd-inbox"), null);
  for (let i = 0; i < 4; i += 1) await flush();
  const pill = root.querySelector(".pxd-inbox");
  assert.equal(pill.textContent, "Inbox (2)");
  pill.click();
  const rows = root.querySelectorAll(".pxd-inbox__row");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].dataset.uid, "new000001");
  const set = {};
  rows[0].dispatchEvent({ type: "dragstart", dataTransfer: { setData: (k, v) => { set[k] = v; } } });
  assert.equal(set[CARD_MIME], "((new000001))");
  rows[0].querySelector(".pxd-inbox__place").click();
  assert.deepEqual(placed, [["((new000001))"]]);
  assert.equal(root.querySelectorAll(".pxd-inbox__row").length, 1);
  assert.equal(root.querySelector(".pxd-inbox").textContent, "Inbox (1)");
  root.querySelector(".pxd-inbox__all").click();
  assert.deepEqual(placed[1], ["((old000001))"]);
  assert.equal(root.querySelectorAll(".pxd-inbox__row").length, 0);
  ctl.dispose();
  assert.equal(root.querySelector(".pxd-inbox"), null);
  assert.equal(root.querySelector(".pxd-inbox__panel"), null);
});

test("QI-7: blocks already on the board never appear, and sync drops them when a card lands", async () => {
  const onBoard = new Set(["onboard01"]);
  const { root, ctl } = mountInbox({
    onBoard,
    pull: pulled([ref("onboard01", "October 9th, 2026", 300), ref("fresh0001", "October 8th, 2026", 200)]),
  });
  for (let i = 0; i < 4; i += 1) await flush();
  assert.equal(root.querySelector(".pxd-inbox").textContent, "Inbox (1)");
  onBoard.add("fresh0001");
  ctl.sync();
  assert.equal(root.querySelector(".pxd-inbox"), null);
});

test("QI-8: the board-member rule is well formed EDN-ish text with two branches", () => {
  const rule = BOARD_MEMBER_RULE;
  const open = { "[": 0, "(": 0, "{": 0 };
  const close = { "]": "[", ")": "(", "}": "{" };
  let inString = false;
  for (let i = 0; i < rule.length; i += 1) {
    const c = rule[i];
    if (c === '"' && rule[i - 1] !== "\\") inString = !inString;
    if (inString) continue;
    if (c in open) open[c] += 1;
    if (c in close) {
      open[close[c]] -= 1;
      assert.ok(open[close[c]] >= 0, `unbalanced at ${i}`);
    }
  }
  assert.deepEqual(open, { "[": 0, "(": 0, "{": 0 });
  assert.equal(inString, false);
  assert.equal((rule.match(/\[\(board-member \?board \?b\)/g) || []).length, 2);
  assert.ok(rule.includes('"edges"') && rule.includes('"snapshots"') && rule.includes('"regions"') && rule.includes('"trails"'));
  assert.ok(rule.includes('(= ?t "section")'));
  assert.ok(rule.startsWith("[") && rule.endsWith("]"));
});

test("QI-8: rules install on the api object, q passes the rule as the % input, and unload removes them", () => {
  const calls = [];
  const win = { roamAlphaAPI: { data: { q: (...args) => { calls.push(args); return [["row"]]; } } } };
  const api = { version: "x" };
  const off = installBoardRules(api, win);
  assert.equal(api.rules.boardMember, BOARD_MEMBER_RULE);
  assert.equal(api.rules.boardMemberName, "board-member");
  const query = '[:find ?s :in $ % :where [?board :block/uid "X"] (board-member ?board ?b) [?b :block/string ?s]]';
  assert.deepEqual(api.rules.q(query), [["row"]]);
  assert.deepEqual(calls[0], [query, BOARD_MEMBER_RULE]);
  api.rules.q("[:find ?s :in $ % ?x :where [(identity ?x) ?s]]", "arg");
  assert.deepEqual(calls[1].slice(1), [BOARD_MEMBER_RULE, "arg"]);
  off();
  assert.equal("rules" in api, false);
  const other = createBoardRules({});
  assert.throws(() => other.q(query), /not available/);
  const stale = installBoardRules(api, win);
  const fresh = installBoardRules(api, win);
  stale();
  assert.ok(api.rules, "an older teardown does not remove a newer install");
  fresh();
  assert.equal("rules" in api, false);
});

test("QI-7: the query block itself is not a result; the count equals what the list can show", async () => {
  const all = ["queryUID1", "aaaaaaaa1", "ghostUID1"];
  const backend = {
    hits: async () => ({ uids: all, partial: false }),
    times: () => new Map(),
    details: (order) => order.filter((u) => u !== "ghostUID1").map((uid) => ({ uid, string: `text ${uid}`, page: "Lab" })),
  };
  const ast = parseQuery("{{[[query]]: {and: [[Readwise]] [[TODO]]}}}").ast;
  const got = await loadQueryRows(ast, backend, { tick: async () => {}, exclude: ["queryUID1"] });
  assert.deepEqual(got.rows.map((r) => r.uid), ["aaaaaaaa1"]);
  assert.equal(got.total, 1);
  assert.equal(got.partial, false);
  const none = await loadQueryRows(ast, { ...backend, hits: async () => ({ uids: ["queryUID1"], partial: false }) }, { tick: async () => {}, exclude: ["queryUID1"] });
  assert.deepEqual([none.rows.length, none.total], [0, 0]);
  // A hit the list cannot show (no details) is not counted either.
  const unseen = await loadQueryRows(ast, backend, { tick: async () => {} });
  assert.equal(unseen.total, unseen.rows.length);
});

test("QI-7: a card whose only match is its own block says 0 results above 'No results'", async () => {
  const backend = {
    hits: async () => ({ uids: ["queryUID1", "childUID01"], partial: false }),
    times: () => new Map(),
    details: (order) => order.map((uid) => ({ uid, string: `text ${uid}` })),
  };
  const { root } = mountCard({
    string: "{{[[query]]: {and: [[Readwise]] [[TODO]]}}}",
    backend,
    hostExtra: { pullTree: () => [{ uid: "childUID01", children: [] }] },
  });
  await flush(); await flush(); await flush(); await flush();
  assert.equal(root.querySelectorAll(".pxd-qc__row").length, 0);
  assert.match(root.querySelector(".pxd-qc__empty").textContent, /No results/);
  assert.match(root.querySelector(".pxd-qc__count").textContent, /0 results/);
  assert.doesNotMatch(root.querySelector(".pxd-qc__count").textContent, /partial/);
});
