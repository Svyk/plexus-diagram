// Add-panel sort and the Roam-powered filters: comparators, the muted meta line, narrowing by meta, the one-query-per-
// attribute reads with a uid cache, the host path (librarySearch with a sort, browse), and the panel controls.
import assert from "node:assert/strict";
import test from "node:test";

import {
  assembleMeta, createMetaCache, DEFAULT_SORT, META_QUERIES, USER_NAME_QUERIES, metaFilterActive, metaFilterHostActive, metaLine, narrowByMeta, normalizeMetaFilter, normalizeSort, SORTS, sortLabel, sortNeedsMeta, sortRows,
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
  assert.equal(metaFilterHostActive({ dayMode: "created" }), true);
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

test("meta reads: one query per attribute over the uid list, chunked; the cache reads only what is missing and expires", () => {
  const calls = [];
  const q = (query, uids) => {
    calls.push([Object.keys(META_QUERIES).find((k) => META_QUERIES[k] === query), uids.length]);
    if (query === META_QUERIES.times) return uids.map((u, i) => [u, 100 + i, 200 + i]);
    if (query === META_QUERIES.createdBy) return uids.map((u) => [u, "Ann"]);
    if (query === META_QUERIES.refs) return [[uids[0], 4]];
    if (query === META_QUERIES.children) return [[uids[1], 2]];
    if (query === META_QUERIES.lengths) return [[uids[0], "hello"]];
    return [];
  };
  const m = assembleMeta(["u1", "u2"], q);
  assert.deepEqual(m.get("u1"), { created: 100, edited: 200, createdBy: "Ann", editedBy: "", refs: 4, children: 0, length: 5 });
  assert.deepEqual(m.get("u2"), { created: 101, edited: 201, createdBy: "Ann", editedBy: "", refs: 0, children: 2, length: null });
  assert.deepEqual(calls.map((c) => c[0]), ["times", "createdByPage", "createdBy", "editedByPage", "editedBy", "refs", "children", "lengths"]);
  calls.length = 0;
  assembleMeta(Array.from({ length: 230 }, (_, i) => `u${i}`), q);
  assert.equal(calls.filter((c) => c[0] === "times").length, 3, "100 uids per call");
  let t = 0;
  const reads = [];
  const cache = createMetaCache((uids) => { reads.push(uids.slice()); return assembleMeta(uids, q); }, { ttl: 1000, now: () => t });
  cache.get(["u1", "u2"]);
  cache.get(["u2", "u3"]);
  assert.deepEqual(reads, [["u1", "u2"], ["u3"]]);
  t = 5000;
  cache.get(["u1"]);
  assert.deepEqual(reads.at(-1), ["u1"], "stale entries are read again");
});

// ---- host

function hostWithGraph() {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  const seen = [];
  fake.onQuery(/:find/, (query, ...inputs) => {
    seen.push(query);
    if (query === META_QUERIES.times) return inputs[0].map((u) => [u, { pg1: NOW - 9 * D, pg2: NOW - 2 * D, pg3: NOW - 30 * D }[u] ?? 0, { pg1: NOW - 1 * D, pg2: NOW - 3 * H, pg3: NOW - 29 * D }[u] ?? 0]);
    if (query === META_QUERIES.createdBy) return inputs[0].map((u) => [u, u === "pg2" ? "Ann" : "Bo"]);
    if (query === META_QUERIES.refs) return [["pg1", 20], ["pg2", 1]];
    if (query === META_QUERIES.children) return [["pg1", 5], ["pg3", 8]];
    if (query.includes("[?p :node/title ?t]") && query.includes("[(re-find ?re ?t)]")) return [["Plexus one", "pg1", Date.now()], ["Plexus two", "pg2", Date.now()], ["Plexus three", "pg3", Date.now()]];
    if (query === USER_NAME_QUERIES[0]) return [["Bo"]];
    if (query === USER_NAME_QUERIES[1]) return [["Ann"], ["Bo"]];
    if (query === META_QUERIES.createdByPage) return [];
    if (query.includes("[:find ?t ?u ?c ?e")) return [["Plexus one", "pg1", NOW - 9 * D, NOW - 1 * D], ["Plexus two", "pg2", NOW - 2 * D, NOW - 3 * H], ["roam/css", "r", 1, 1]];
    return [];
  });
  return { host, seen };
}

test("librarySearch with a sort reads the numbers once for the candidates and orders by them; best match reads none", () => {
  const { host, seen } = hostWithGraph();
  const best = host.librarySearch({ text: "plexus", types: ["page"] }, 40);
  assert.deepEqual(best.rows.map((r) => r.string), ["[[Plexus one]]", "[[Plexus two]]", "[[Plexus three]]"]);
  assert.equal(seen.includes(META_QUERIES.times), false, "no extra reads for Best match");
  assert.equal(best.rows[0].meta, undefined);
  const edited = host.librarySearch({ text: "plexus", types: ["page"] }, 40, { sort: "edited" });
  assert.deepEqual(edited.rows.map((r) => r.string), ["[[Plexus two]]", "[[Plexus one]]", "[[Plexus three]]"]);
  assert.equal(edited.rows[0].meta.edited, NOW - 3 * H);
  assert.ok(edited.queries.some((q) => q.name === "meta"));
  const linked = host.librarySearch({ text: "plexus", types: ["page"] }, 40, { sort: "linked" });
  assert.deepEqual(linked.rows.map((r) => r.string), ["[[Plexus one]]", "[[Plexus two]]", "[[Plexus three]]"]);
  assert.equal(seen.filter((x) => x === META_QUERIES.times).length, 1, "the second sort used the uid cache");
  assert.deepEqual(host.librarySearch({ text: "plexus", types: ["page"], createdBy: "Ann" }, 40).rows.map((r) => r.string), ["[[Plexus two]]"]);
  assert.deepEqual(host.librarySearch({ text: "plexus", types: ["page"], children: true }, 40).rows.map((r) => r.string), ["[[Plexus one]]", "[[Plexus three]]"]);
  assert.deepEqual(host.librarySearch({ text: "plexus", types: ["page"], days: 7, dayMode: "created" }, 40).rows.map((r) => r.string), ["[[Plexus two]]"]);
});

test("browse (no text) lists pages by the sort from one page-level query; user names for the filters", () => {
  const { host } = hostWithGraph();
  assert.deepEqual(host.browse("edited", 10).rows.map((r) => r.text), ["Plexus two", "Plexus one"]);
  assert.deepEqual(host.browse("oldest", 10).rows.map((r) => r.text), ["Plexus one", "Plexus two"]);
  assert.deepEqual(host.browse("title", 1).rows.map((r) => r.text), ["Plexus one"]);
  assert.deepEqual(host.userNames(), ["Ann", "Bo"]);
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
  assert.deepEqual(calls.at(-1), { browse: "linked" }, "an empty search lists pages by the sort");
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
  await tick();
  assert.equal(seen.at(-1).createdBy, "Ann");
  const refs = byLabel("Has linked references");
  refs.checked = true;
  f.stub.dispatch(refs, "change");
  await tick();
  assert.equal(seen.at(-1).refs, true);
  assert.equal(more.textContent, "More · 2");
  const board = byLabel("On this board");
  board.checked = true;
  f.stub.dispatch(board, "change");
  await tick();
  assert.deepEqual(f.root.querySelectorAll(".pxd-panel__pane--search .pxd-panel__row").map((r) => r.dataset.string), ["[[Beta]]"]);
  assert.equal(pop.querySelectorAll("label").some((l) => l.className === "pxd-panel__orphan"), true, "Not on any board lives here too");
});
