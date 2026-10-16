// Add-panel sort and the Roam-powered filters: comparators, the muted meta line, narrowing by meta, the one-query-per-
// attribute reads with a uid cache, the host path (librarySearch with a sort, browse), and the panel controls.
import assert from "node:assert/strict";
import test from "node:test";

import {
  assembleMeta, createMetaCache, DEFAULT_SORT, META_PULL, META_REFS, USER_NAME_QUERIES, metaFilterActive, metaFilterHostActive, metaLine, narrowByMeta, normalizeMetaFilter, normalizeSort, SORTS, sortLabel, sortNeedsMeta, sortRows,
} from "../src/model/search-sort.js";
import { libraryCard } from "../src/model/library.js";
import { createHost } from "../src/host/roam.js";
import { createPanel } from "../src/view/panel.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";

const NOW = Date.parse("2026-10-11T18:00:00Z");
const H = 3600000;
const D = 24 * H;
const R = (uid, title, meta) => ({ uid, kind: "page", title, meta });
const ROWS = [
  R("a", "Beta", { created: NOW - 40 * D, edited: NOW - 2 * H, createdBy: "Ann", editedBy: "Bo", refs: 3, children: 9, length: null }),
  R("b", "alpha", { created: NOW - 5 * D, edited: NOW - 30 * D, createdBy: "Bo", editedBy: "Bo", refs: 12, children: 0, length: null }),
  R("c", "Gamma", { created: NOW - 1 * D, edited: NOW - 1 * D, createdBy: "Ann", editedBy: "Ann", refs: 0, children: 2, length: null }),
  { uid: "d", kind: "block", string: "x".repeat(300), pageTitle: "Lab", meta: { created: NOW - 400 * D, edited: NOW - 400 * D, createdBy: "Bo", editedBy: "Bo", refs: 1, children: 1, length: 300 } },
  { uid: "e", kind: "page", title: "No numbers" },
];
const ids = (rows) => rows.map((r) => r.uid);

test("sorts: best keeps the incoming order, the others order by Roam's numbers, rows without numbers go last", () => {
  assert.deepEqual(SORTS.map((s) => s.id), ["best", "edited", "created", "oldest", "linked", "children", "longest", "title"]);
  assert.equal(normalizeSort("nope"), DEFAULT_SORT);
  assert.equal(sortLabel("linked"), "Most linked");
  assert.deepEqual(ids(sortRows(ROWS, "best")), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(ids(sortRows(ROWS, "edited")), ["a", "c", "b", "d", "e"]);
  assert.deepEqual(ids(sortRows(ROWS, "created")), ["c", "b", "a", "d", "e"]);
  assert.deepEqual(ids(sortRows(ROWS, "oldest")), ["d", "a", "b", "c", "e"]);
  assert.deepEqual(ids(sortRows(ROWS, "linked")), ["b", "a", "d", "c", "e"]);
  assert.deepEqual(ids(sortRows(ROWS, "children")), ["a", "c", "d", "b", "e"]);
  assert.deepEqual(ids(sortRows(ROWS, "longest"))[0], "d");
  const titles = sortRows(ROWS, "title").map((r) => r.title || r.string.slice(0, 1));
  assert.deepEqual(titles, ["alpha", "Beta", "Gamma", "No numbers", "x"], "case-insensitive A–Z over the title or text");
  assert.equal(ROWS[0].uid, "a", "the input is not reordered");
  assert.equal(sortNeedsMeta("best"), false);
  assert.equal(sortNeedsMeta("title"), false);
  assert.equal(sortNeedsMeta("linked"), true);
});

test("the muted line shows the value the sort is about", () => {
  assert.equal(metaLine(ROWS[0], "edited", NOW), "edited 2 h ago by Bo");
  assert.equal(metaLine(ROWS[1], "edited", NOW), "edited Sep 11 by Bo", "past 30 days it is a date");
  assert.equal(metaLine(ROWS[1], "created", NOW), "created Oct 6 by Bo");
  assert.equal(metaLine(ROWS[3], "oldest", NOW), "created Sep 6, 2025 by Bo");
  assert.equal(metaLine(ROWS[1], "linked", NOW), "12 refs");
  assert.equal(metaLine({ meta: { refs: 1 } }, "linked", NOW), "1 ref");
  assert.equal(metaLine(ROWS[0], "children", NOW), "9 children");
  assert.equal(metaLine(ROWS[3], "longest", NOW), "300 characters");
  assert.equal(metaLine(ROWS[0], "best", NOW), "");
  assert.equal(metaLine(ROWS[4], "linked", NOW), "", "no numbers, no line");
});

test("Roam filters: created by, edited by, created within N days, linked refs, children, under a page", () => {
  assert.deepEqual(normalizeMetaFilter({ createdBy: " Ann ", dayMode: "created", refs: true, under: "Lab", parsed: "yes" }),
    { createdBy: "Ann", editedBy: "", dayMode: "created", refs: true, children: false, under: "Lab", parsed: false, highlights: false, thisBoard: false });
  assert.equal(metaFilterActive({}), false);
  assert.equal(metaFilterActive({ thisBoard: true }), true);
  assert.equal(metaFilterHostActive({ thisBoard: true }), false, "board-only filters are not the host's");
  assert.equal(metaFilterHostActive({ dayMode: "created" }), false, "the days mode alone filters nothing");
  assert.equal(metaFilterActive({ dayMode: "created", days: "" }), false, "an empty days box keeps parts and browse on");
  assert.equal(metaFilterHostActive({ dayMode: "created", days: 7 }), true);
  const run = (f, days = 0) => ids(narrowByMeta(ROWS, f, { days, now: NOW }));
  assert.deepEqual(run({ createdBy: "ann" }), ["a", "c"]);
  assert.deepEqual(run({ editedBy: "Bo" }), ["a", "b", "d"]);
  assert.deepEqual(run({ dayMode: "created" }, 7), ["b", "c"]);
  assert.deepEqual(run({ dayMode: "edited" }, 7), ["a", "b", "c", "d", "e"], "edited days are the host's own filter");
  assert.deepEqual(run({ refs: true }), ["a", "b", "d"]);
  assert.deepEqual(run({ children: true }), ["a", "c", "d"]);
  assert.deepEqual(run({ under: "lab" }), ["d"]);
  assert.deepEqual(run({ under: "Beta" }), ["a"], "a page is under itself");
  assert.deepEqual(run({ refs: true, createdBy: "Bo" }), ["b", "d"]);
});

test("meta reads: one pull_many per 100 uids and one eid-bound ref count; the cache reads only what is missing, expires and stays bounded", () => {
  const calls = [];
  const node = (u, i) => ({
    ":db/id": 1000 + i,
    ":block/uid": u,
    ":create/time": 100 + i,
    ":edit/time": 200 + i,
    ...(u === "u1" ? { ":block/string": "hello", ":create/user": { ":user/display-page": { ":node/title": "Ann" } } } : {}),
    ...(u === "u2" ? { ":block/children": [{ ":db/id": 7 }, { ":db/id": 8 }], ":edit/user": { ":user/display-name": "Bo" } } : {}),
  });
  const pullMany = (pattern, eids) => {
    calls.push(["pull", pattern, eids.length]);
    return eids.map(([, u], i) => (u === "gone" ? null : node(u, i)));
  };
  const q = (query, eids) => { calls.push(["q", query, eids.length]); return [[1000, 4]]; };
  const m = assembleMeta(["u1", "u2", "gone"], { pullMany, q });
  assert.deepEqual(m.get("u1"), { created: 100, edited: 200, createdBy: "Ann", editedBy: "", refs: 4, children: 0, length: 5 });
  assert.deepEqual(m.get("u2"), { created: 101, edited: 201, createdBy: "", editedBy: "Bo", refs: 0, children: 2, length: null });
  assert.equal(m.has("gone"), false);
  assert.deepEqual(calls, [["pull", META_PULL, 3], ["q", META_REFS, 2]], "no uid-bound datalog");
  calls.length = 0;
  assembleMeta(Array.from({ length: 230 }, (_, i) => `u${i}`), { pullMany, q });
  assert.equal(calls.filter((c) => c[0] === "pull").length, 3, "100 uids per pull");
  assert.equal(calls.filter((c) => c[0] === "q").length, 3, "one ref count per chunk");
  let t = 0;
  const reads = [];
  const cache = createMetaCache((uids) => { reads.push(uids.slice()); return assembleMeta(uids, { pullMany, q }); }, { ttl: 1000, now: () => t, max: 3 });
  cache.get(["u1", "u2"]);
  cache.get(["u2", "u3"]);
  assert.deepEqual(reads, [["u1", "u2"], ["u3"]]);
  t = 5000;
  cache.get(["u1"]);
  assert.deepEqual(reads.at(-1), ["u1"], "stale entries are read again");
  cache.get(["u4", "u5"]);
  assert.equal(cache.size(), 3, "bounded");
  cache.get(["u1"]);
  assert.deepEqual(reads.at(-1), ["u4", "u5"], "the newest reads stay");
});

// ---- host

function hostWithGraph() {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  const seen = [];
  const META = {
    pg1: { c: NOW - 9 * D, e: NOW - 1 * D, by: "Bo", refs: 20, kids: 5 },
    pg2: { c: NOW - 2 * D, e: NOW - 3 * H, by: "Ann", refs: 1, kids: 0 },
    pg3: { c: NOW - 30 * D, e: NOW - 29 * D, by: "Bo", refs: 0, kids: 8 },
  };
  const eidOf = (u) => 500 + Object.keys(META).indexOf(u);
  fake.api.data.pull_many = (pattern, eids) => {
    seen.push(pattern);
    return eids.map(([, u]) => {
      const m = META[u];
      if (!m) return null;
      return { ":db/id": eidOf(u), ":block/uid": u, ":create/time": m.c, ":edit/time": m.e, ":create/user": { ":user/display-name": m.by }, ":block/children": Array.from({ length: m.kids }, (_, i) => ({ ":db/id": i })) };
    });
  };
  fake.onQuery(/:find/, (query, ...inputs) => {
    seen.push(query);
    if (query === META_REFS) return inputs[0].map((eid) => [eid, META[Object.keys(META)[eid - 500]]?.refs || 0]).filter((r) => r[1]);
    if (query.includes("[?p :node/title ?t]") && query.includes("[(re-find ?re ?t)]")) return [["Plexus one", "pg1", Date.now()], ["Plexus two", "pg2", Date.now()], ["Plexus three", "pg3", Date.now()]];
    if (query === USER_NAME_QUERIES[0]) return [["Bo"]];
    if (query === USER_NAME_QUERIES[1]) return [["Ann"], ["Bo"]];
    if (query.includes("(pull ?p [:node/title :block/uid :create/time :edit/time])")) return [[{ ":node/title": "Plexus one", ":block/uid": "pg1", ":create/time": NOW - 9 * D, ":edit/time": NOW - 1 * D }], [{ ":node/title": "Plexus two", ":block/uid": "pg2", ":create/time": NOW - 2 * D, ":edit/time": NOW - 3 * H }], [{ ":node/title": "roam/css", ":block/uid": "r", ":create/time": 1, ":edit/time": 1 }]];
    return [];
  });
  return { host, seen };
}

test("librarySearch with a sort reads the numbers once for the candidates and orders by them; best match reads none", (t) => {
  t.mock.method(Date, "now", () => NOW + 1000);
  const { host, seen } = hostWithGraph();
  const best = host.librarySearch({ text: "plexus", types: ["page"] }, 40);
  assert.deepEqual(best.rows.map((r) => r.string), ["[[Plexus one]]", "[[Plexus two]]", "[[Plexus three]]"]);
  assert.equal(seen.includes(META_PULL), false, "no extra reads for Best match");
  assert.equal(best.rows[0].meta, undefined);
  const edited = host.librarySearch({ text: "plexus", types: ["page"] }, 40, { sort: "edited" });
  assert.deepEqual(edited.rows.map((r) => r.string), ["[[Plexus two]]", "[[Plexus one]]", "[[Plexus three]]"]);
  assert.equal(edited.rows[0].meta.edited, NOW - 3 * H);
  assert.ok(edited.queries.some((q) => q.name === "meta"));
  const linked = host.librarySearch({ text: "plexus", types: ["page"] }, 40, { sort: "linked" });
  assert.deepEqual(linked.rows.map((r) => r.string), ["[[Plexus one]]", "[[Plexus two]]", "[[Plexus three]]"]);
  assert.equal(seen.filter((x) => x === META_PULL).length, 1, "the second sort used the uid cache");
  assert.deepEqual(host.librarySearch({ text: "plexus", types: ["page"], createdBy: "Ann" }, 40).rows.map((r) => r.string), ["[[Plexus two]]"]);
  assert.deepEqual(host.librarySearch({ text: "plexus", types: ["page"], children: true }, 40).rows.map((r) => r.string), ["[[Plexus one]]", "[[Plexus three]]"]);
  // The day window counts back from now: the fixture's dates are pinned to NOW, so is the clock here.
  const realNow = Date.now;
  Date.now = () => NOW;
  try {
    assert.deepEqual(host.librarySearch({ text: "plexus", types: ["page"], days: 7, dayMode: "created" }, 40).rows.map((r) => r.string), ["[[Plexus two]]"]);
  } finally { Date.now = realNow; }
});

test("browse (no text) lists pages by the sort from one page-level query; user names for the filters", () => {
  const { host } = hostWithGraph();
  assert.deepEqual(host.browse("edited", 10).rows.map((r) => r.text), ["Plexus two", "Plexus one"]);
  assert.deepEqual(host.browse("oldest", 10).rows.map((r) => r.text), ["Plexus one", "Plexus two"]);
  assert.deepEqual(host.browse("title", 1).rows.map((r) => r.text), ["Plexus one"]);
  assert.deepEqual(host.userNames(), ["Ann", "Bo"]);
});

test("browse reads the page list once and reuses it for the next sorts", () => {
  const { host, seen } = hostWithGraph();
  const isList = (x) => x.includes("(pull ?p [:node/title");
  host.browse("edited", 10);
  host.browse("created", 10);
  host.browse("title", 10);
  assert.equal(seen.filter(isList).length, 1);
});

// ---- panel

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const timers = { later: () => () => {}, frame: () => () => {} };
function mount(on = {}, host = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const root = stub.document.createElement("div");
  root.className = "pxd-root";
  stub.document.body.append(root);
  const panel = createPanel({ doc: stub.document, root, host, timers, on });
  panel.open("search");
  return { stub, restore, root, panel };
}
const q = (root, sel) => root.querySelector(sel);

test("panel: Sort lists the choices, a pick re-runs the search with it, persists it, and rows show the muted meta line", async (t) => {
  const saved = [];
  const calls = [];
  const f = mount({ saveSort: (id) => saved.push(id), loadSort: () => "" }, {
    librarySearch(filter, limit, opts) {
      calls.push({ filter, sort: opts.sort });
      return { rows: [libraryCard({ ...ROWS[0], tags: [] }), libraryCard({ ...ROWS[1], tags: [] })], queries: [] };
    },
    browse(sort) { calls.push({ browse: sort }); return { rows: [libraryCard(ROWS[2])], queries: [] }; },
  });
  t.after(f.restore);
  const btn = q(f.root, ".pxd-panel__sort-btn");
  assert.equal(btn.textContent, "Best match");
  const pop = q(f.root, ".pxd-panel__sort-pop");
  assert.equal(pop.style.display, "none");
  f.stub.dispatch(btn, "click");
  assert.equal(pop.style.display, "");
  assert.deepEqual([...pop.querySelectorAll(".pxd-panel__sort-item")].map((b) => b.textContent), SORTS.map((s) => s.label));
  const input = q(f.root, ".pxd-panel__input");
  input.value = "x";
  f.stub.dispatch(input, "keydown", { key: "Enter" });
  await tick();
  assert.equal(calls.at(-1).sort, "best");
  assert.equal(f.root.querySelectorAll(".pxd-panel__row-meta").length, 0, "no meta line for Best match");
  f.stub.dispatch(f.root.querySelectorAll(".pxd-panel__sort-item").find((b) => b.dataset.sort === "linked"), "click");
  await tick();
  assert.equal(calls.at(-1).sort, "linked");
  assert.deepEqual(saved, ["linked"]);
  assert.equal(btn.textContent, "Most linked");
  assert.equal(pop.style.display, "none");
  assert.deepEqual(f.root.querySelectorAll(".pxd-panel__row-meta").map((n) => n.textContent), ["3 refs", "12 refs"]);
  input.value = "";
  f.stub.dispatch(input, "keydown", { key: "Enter" });
  await tick();
  assert.equal(calls.some((c) => c.browse), false, "Most linked does not browse: it would list recently edited pages under ref counts");
  f.stub.dispatch(f.root.querySelectorAll(".pxd-panel__sort-item").find((b) => b.dataset.sort === "created"), "click");
  await tick();
  assert.deepEqual(calls.at(-1), { browse: "created" }, "an empty search lists pages by a time or title sort");
});

test("panel: More holds the Roam filters; changing one searches again with it, and the button counts them", async (t) => {
  const seen = [];
  const f = mount({ userNames: () => ["Ann", "Bo"], isOnBoard: (s) => s === "[[Beta]]" }, {
    librarySearch(filter) { seen.push(filter); return { rows: [libraryCard({ ...ROWS[0], tags: [] }), libraryCard({ ...ROWS[1], tags: [] })], queries: [] }; },
  });
  t.after(f.restore);
  const more = q(f.root, ".pxd-panel__more-btn");
  const pop = q(f.root, ".pxd-panel__more-pop");
  assert.equal(more.textContent, "More");
  f.stub.dispatch(more, "click");
  assert.equal(pop.style.display, "");
  const byLabel = (label) => pop.querySelectorAll("select, input").find((n) => n.getAttribute("aria-label") === label);
  const sel = byLabel("Created by");
  assert.deepEqual([...sel.querySelectorAll("option")].map((o) => o.textContent), ["Anyone", "Ann", "Bo"]);
  const input = q(f.root, ".pxd-panel__input");
  input.value = "x";
  f.stub.dispatch(input, "keydown", { key: "Enter" });
  await tick();
  sel.value = "Ann";
  f.stub.dispatch(sel, "change");
  f.stub.dispatch(input, "keydown", { key: "Enter" });
  await tick();
  assert.equal(seen.at(-1).createdBy, "Ann");
  const refs = byLabel("Has linked references");
  refs.checked = true;
  f.stub.dispatch(refs, "change");
  f.stub.dispatch(input, "keydown", { key: "Enter" });
  await tick();
  assert.equal(seen.at(-1).refs, true);
  assert.equal(more.textContent, "More · 2");
  const board = byLabel("On this board");
  board.checked = true;
  f.stub.dispatch(board, "change");
  f.stub.dispatch(input, "keydown", { key: "Enter" });
  await tick();
  assert.deepEqual(f.root.querySelectorAll(".pxd-panel__pane--search .pxd-panel__row").map((r) => r.dataset.string), ["[[Beta]]"]);
  assert.equal(pop.querySelectorAll("label").some((l) => l.className === "pxd-panel__orphan"), true, "Not on any board lives here too");
});

test("panel: Under page asks for page titles once after a pause, not on every key", async (t) => {
  const asked = [];
  const pending = [];
  const later = (fn) => { const job = { fn, live: true }; pending.push(job); return () => { job.live = false; }; };
  const stub = createDomStub();
  const restore = stub.install();
  t.after(restore);
  const root = stub.document.createElement("div");
  root.className = "pxd-root";
  stub.document.body.append(root);
  const panel = createPanel({ doc: stub.document, root, host: { searchPages: (text) => { asked.push(text); return [{ title: "Lab notes" }]; } }, timers: { later, frame: () => () => {} }, on: {} });
  panel.open("search");
  const under = root.querySelector(".pxd-panel__more-under");
  for (const v of ["l", "la", "lab", "lab", "lab "]) { under.value = v; stub.dispatch(under, "keyup", { key: "x" }); }
  assert.deepEqual(asked, [], "nothing read while typing");
  for (const job of pending.splice(0)) if (job.live) job.fn();
  assert.deepEqual(asked, ["lab"], "one read for the settled text");
  assert.deepEqual(root.querySelectorAll(".pxd-panel__more-pages option").map((o) => o.getAttribute("value")), ["Lab notes"]);
  panel.dispose();
});
