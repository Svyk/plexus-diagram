// Search filters with an empty box (filter browse): the query built per filter, the 30-day default for unbounded sets,
// ordering, the host run (chunked pull, cache, PDF filters), PDF filters on Meaning rows, and the panel (debounce, stale
// runs, empty-state wording).
import assert from "node:assert/strict";
import test from "node:test";

import {
  BROWSE_DEFAULT_DAYS, DEFAULT_WINDOW_NOTE, FILTER_DEBOUNCE_MS, browseCountBy, browseEmptyText, browseKey, browseOrdered, browseQuery, browseSpec, browseTime, orderBrowse, wantsFilterBrowse,
} from "../src/model/filter-browse.js";
import { libraryCard } from "../src/model/library.js";
import { createHost } from "../src/host/roam.js";
import { createPanel } from "../src/view/panel.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";

const NOW = Date.parse("2026-10-11T18:00:00Z");
const D = 86400000;
const PATTERNS = { pdf: "PDF", image: "IMG", web: "WEB", region: "REG", pin: "PIN", board: "DIA" };

test("filter browse runs only with an empty box, no tag, and a filter that needs the graph", () => {
  assert.equal(wantsFilterBrowse({ text: "", days: 7 }), true);
  assert.equal(wantsFilterBrowse({ text: "x", days: 7 }), false, "typed text is a keyword search");
  assert.equal(wantsFilterBrowse({ text: "", tag: "TODO", days: 7 }), false, "a tag is the tag search");
  assert.equal(wantsFilterBrowse({ text: "" }), false, "nothing set: the plain browse");
  assert.equal(wantsFilterBrowse({ text: "", types: ["pdf"] }), false, "a type alone lists through librarySearch");
  for (const f of [{ createdBy: "Ann" }, { editedBy: "Ann" }, { under: "Lab" }, { refs: true }, { children: true }, { parsed: true }, { highlights: true }, { thisBoard: true }, { orphan: true }]) {
    assert.equal(wantsFilterBrowse({ text: "", ...f }), true, JSON.stringify(f));
  }
  assert.equal(wantsFilterBrowse({ text: "", dayMode: "created" }), false, "the days mode alone filters nothing");
});

test("query: days=7 created binds the create-time window first", () => {
  const spec = browseSpec({ days: 7, dayMode: "created" }, { now: NOW });
  assert.equal(spec.defaulted, false);
  assert.equal(spec.shape, "any");
  const { query, args } = browseQuery(spec, { patterns: PATTERNS });
  assert.equal(query, "[:find ?b ?t :in $ ?since :where [?b :create/time ?t] [(> ?t ?since)]]");
  assert.deepEqual(args, [NOW - 7 * D]);
  assert.equal(browseQuery(spec, { sort: "edited" }).query, "[:find ?b ?t :in $ ?since :where [?b :create/time ?w] [(> ?w ?since)] [?b :edit/time ?t]]", "Recently edited orders by the edit time");
});

test("query: edited by a user today binds the edit window, then the user entities", () => {
  const spec = browseSpec({ days: 1, editedBy: "Svy" }, { now: NOW });
  const { query, args } = browseQuery(spec, { patterns: PATTERNS, users: { edited: [11, 12] } });
  assert.equal(query, "[:find ?b ?t :in $ ?since [?eu ...] :where [?b :edit/time ?t] [(> ?t ?since)] [?b :edit/user ?eu]]");
  assert.deepEqual(args, [NOW - D, [11, 12]]);
  assert.equal(browseQuery(spec, { patterns: PATTERNS, users: { edited: null } }), null, "no such user: nothing can match");
});

test("query: Under page is bounded by the page and starts there; no window is added", () => {
  const spec = browseSpec({ under: "Plexus Diagram" }, { now: NOW });
  assert.equal(spec.defaulted, false);
  assert.equal(spec.since, null);
  const { query, args } = browseQuery(spec, { patterns: PATTERNS });
  assert.equal(query, "[:find ?b ?t :in $ ?under :where [?pg :node/title ?under] [?b :block/page ?pg] [?b :edit/time ?t]]");
  assert.deepEqual(args, ["Plexus Diagram"]);
});

test("query: Parsed PDFs / highlights are PDF blocks found by the pdf pattern (bounded)", () => {
  const spec = browseSpec({ parsed: true }, { now: NOW });
  assert.equal(spec.shape, "kinds");
  assert.deepEqual(spec.kinds, ["pdf"]);
  assert.equal(spec.defaulted, false);
  const { query, args } = browseQuery(spec, { patterns: PATTERNS });
  assert.match(query, /^\[:find \?b \?t :in \$ \?kpat :where \[\?b :block\/string \?s\] \[\(re-pattern \?kpat\) \?kre\] \[\(re-find \?kre \?s\)\]/);
  assert.deepEqual(args, ["(?:PDF)"]);
  assert.equal(browseSpec({ parsed: true, types: ["page"] }), null, "PDFs filtered while PDFs are hidden: nothing to list");
  const kinds = browseQuery(browseSpec({ types: ["image", "board"], editedBy: "A" }, { now: NOW }), { patterns: PATTERNS, users: { edited: [1] } });
  assert.deepEqual(kinds.args, ["(?:IMG)|(?:DIA)", [1]], "several kinds are one alternation");
});

test("query: has linked refs + has children are existence clauses (no aggregates); unbounded sets default to 30 days edited", () => {
  const spec = browseSpec({ refs: true, children: true }, { now: NOW });
  assert.equal(spec.defaulted, true);
  assert.equal(spec.days, BROWSE_DEFAULT_DAYS);
  assert.equal(spec.mode, "edited");
  const { query, args } = browseQuery(spec, { patterns: PATTERNS });
  assert.equal(query, "[:find ?b ?t :in $ ?since :where [?b :edit/time ?t] [(> ?t ?since)] [?r :block/refs ?b] [?b :block/children ?k]]");
  assert.doesNotMatch(query, /count|get-else/);
  assert.deepEqual(args, [NOW - 30 * D]);
  for (const f of [{ children: true }, { createdBy: "Ann" }, { orphan: true }, { thisBoard: true }]) {
    assert.equal(browseSpec(f, { now: NOW }).defaulted, true, JSON.stringify(f));
  }
  assert.equal(browseSpec({ children: true, days: 90 }, { now: NOW }).defaulted, false, "a days value widens it");
  assert.equal(DEFAULT_WINDOW_NOTE, "Showing the last 30 days — set days to widen");
  assert.equal(browseEmptyText(spec), "Nothing edited in the last 30 days — set days to widen");
  assert.equal(browseEmptyText(browseSpec({ parsed: true })), "No parsed PDFs");
  assert.equal(browseEmptyText(browseSpec({ highlights: true })), "No PDFs with highlights");
  assert.equal(browseEmptyText(browseSpec({ days: 3 })), "No matches");
});

test("query: page-only and block-only types add one structural clause", () => {
  assert.match(browseQuery(browseSpec({ days: 2, types: ["page"] }, { now: NOW })).query, /\[\?b :node\/title _\]/);
  assert.match(browseQuery(browseSpec({ days: 2, types: ["daily"] }, { now: NOW })).query, /\[\?b :node\/title _\]/);
  assert.match(browseQuery(browseSpec({ days: 2, types: ["block", "pdf"] }, { now: NOW })).query, /\[\?b :block\/page _\]/);
  assert.equal(browseSpec({ days: 2, types: ["paragraph", "table"] }), null, "parse parts are not graph rows");
});

test("ordering: by the sort's time, by counts for Most linked / Most children when the filter is on, oldest ascending", () => {
  const spec = browseSpec({ refs: true }, { now: NOW });
  const rows = [[1, 50], [2, 20], [3, 40]];
  assert.deepEqual(orderBrowse(rows, "edited").map((r) => r.eid), [1, 3, 2]);
  assert.deepEqual(orderBrowse(rows, "oldest").map((r) => r.eid), [2, 3, 1]);
  const counts = new Map([[1, 2], [2, 9], [3, 9]]);
  assert.deepEqual(orderBrowse(rows, "linked", counts).map((r) => r.eid), [3, 2, 1], "most refs, ties by recent time");
  assert.equal(browseCountBy(spec, "linked"), "refs");
  assert.equal(browseCountBy(spec, "children"), null);
  assert.equal(browseCountBy(browseSpec({ children: true }), "children"), "children");
  assert.equal(browseTime(browseSpec({ days: 3, dayMode: "created" }), "best"), "created", "best follows the days box's time");
  assert.equal(browseTime(browseSpec({ days: 3, dayMode: "created" }), "edited"), "edited");
  assert.equal(browseTime(browseSpec({ days: 3 }), "oldest"), "created");
  assert.equal(browseOrdered(spec, "linked"), true);
  assert.equal(browseOrdered(browseSpec({ days: 1 }), "linked"), false, "no count filter: numbers first");
  assert.equal(browseOrdered(spec, "title"), false);
  assert.notEqual(browseKey(browseSpec({ days: 1 }, { now: 1 }), "best", 40), browseKey(browseSpec({ days: 2 }, { now: 1 }), "best", 40));
  assert.equal(browseKey(browseSpec({ days: 1 }, { now: 1 }), "best", 40), browseKey(browseSpec({ days: 1 }, { now: 9e12 }), "best", 40), "the clock is not in the key");
});

// ---- host

function graph() {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  const t = Date.now();
  const NODES = {
    1: { ":db/id": 1, ":block/uid": "pA", ":node/title": "Alpha", ":create/time": t - 2 * D, ":edit/time": t - 1000 },
    2: { ":db/id": 2, ":block/uid": "b1", ":block/string": "a note", ":block/page": { ":node/title": "Alpha" }, ":create/time": t - D, ":edit/time": t - 5000 },
    3: { ":db/id": 3, ":block/uid": "b2", ":block/string": "{{[[pdf]]: https://x/one.pdf}}", ":block/page": { ":node/title": "Alpha" }, ":create/time": t - 3 * D, ":edit/time": t - 9000 },
    4: { ":db/id": 4, ":block/uid": "b3", ":block/string": "{{[[pdf]]: https://x/two.pdf}}", ":block/page": { ":node/title": "Beta" }, ":create/time": t - 4 * D, ":edit/time": t - 8000, ":block/props": { ":plexus-reads": { builtin: "x" } } },
    5: { ":db/id": 5, ":block/uid": "r1", ":node/title": "roam/css", ":create/time": t, ":edit/time": t },
  };
  const byUid = new Map(Object.values(NODES).map((n) => [n[":block/uid"], n]));
  const pulls = [];
  fake.api.data.pull_many = (pattern, eids) => {
    pulls.push([pattern, eids.length]);
    return eids.map((e) => (Array.isArray(e) ? byUid.get(e[1]) : NODES[e]) || null);
  };
  const browse = fake.onQuery(/^\[:find \?b \?t/, (query) => Object.values(NODES).map((n) => [n[":db/id"], query.includes("?t] [(> ?t") && query.includes(":create/time ?t") ? n[":create/time"] : n[":edit/time"]]));
  const counted = fake.onQuery(/^\[:find \?b \(count \?r\) :in \$ \[\?b \.\.\.\]/, (query, eids) => eids.map((e) => [e, e === 3 ? 7 : 1]));
  fake.onQuery(/:pdf\/url \?url\] \[\?b :block\/page/, () => [["https://x/one.pdf", { ":pdf-highlight": { a: 1 } }], ["https://x/one.pdf", { ":other": 1 }]]);
  fake.onQuery(/user\/display/, () => [[11, "Svy"]]);
  return { fake, host, browse, pulls, counted };
}

test("host filterBrowse: one query, rows pulled by entity id, roam/ pages out, numbers attached, cached 30 s", () => {
  const { host, browse } = graph();
  const out = host.filterBrowse({ days: 7 }, 40, { sort: "edited" });
  assert.deepEqual(out.rows.map((r) => r.string), ["[[Alpha]]", "((b1))", "((b3))", "((b2))"]);
  assert.equal(out.defaulted, false);
  assert.equal(browse.calls.length, 1);
  assert.ok(out.queries.some((q) => q.name === "browse"));
  const again = host.filterBrowse({ days: 7 }, 40, { sort: "edited" });
  assert.equal(browse.calls.length, 1, "the same filter set within 30 s reads nothing");
  assert.deepEqual(again.queries.map((q) => q.name), ["browse-cache"]);
  host.filterBrowse({ days: 7, types: ["pdf"] }, 40, { sort: "edited" });
  assert.equal(browse.calls.length, 2, "another filter set reads again");
  const board = host.filterBrowse({ days: 7 }, 40, { sort: "edited", keep: (s) => s === "((b1))" });
  assert.deepEqual(board.rows.map((r) => r.string), ["((b1))"], "On this board keeps the board's cards");
  assert.equal(browse.calls.length, 3, "a board filter is never served from the cache");
});

test("host filterBrowse: has linked refs + Most linked counts the result by entity id and orders by it", () => {
  const { host, counted } = graph();
  const out = host.filterBrowse({ refs: true }, 40, { sort: "linked" });
  assert.equal(counted.calls.length >= 1, true);
  assert.equal(out.rows[0].string, "((b2))", "eid 3 has the most refs");
});

test("host filterBrowse: unbounded sets say they defaulted; an unknown user matches nothing", () => {
  const { host, browse } = graph();
  const out = host.filterBrowse({ children: true }, 40);
  assert.equal(out.defaulted, true);
  assert.match(browse.calls[0][0], /:edit\/time \?t\] \[\(> \?t \?since\)\]/);
  assert.equal(host.filterBrowse({ days: 1, editedBy: "nobody" }, 40).rows.length, 0);
  host.filterBrowse({ days: 1, editedBy: "svy" }, 40);
  assert.deepEqual(browse.calls.at(-1).slice(-1)[0], [11], "user names match without case");
});

test("host filterBrowse: Parsed PDFs alone list the caller's PDF list; parsed = parse store or plexus-reads; highlights in one read", () => {
  const { host, browse } = graph();
  const pdfList = () => [
    { uid: "b2", string: "{{[[pdf]]: https://x/one.pdf}}", pageTitle: "Alpha" },
    { uid: "b3", string: "{{[[pdf]]: https://x/two.pdf}}", pageTitle: "Beta" },
  ];
  const parsed = host.filterBrowse({ parsed: true }, 40, { pdfList, parsedUrls: new Set(["https://x/one.pdf"]) });
  assert.deepEqual(parsed.rows.map((r) => r.uid).sort(), ["b2", "b3"], "one in the parse store, one with a kept read");
  assert.equal(browse.calls.length, 0, "no graph query");
  const onlyStore = host.filterBrowse({ parsed: true }, 40, { pdfList, parsedUrls: new Set() });
  assert.deepEqual(onlyStore.rows.map((r) => r.uid), ["b3"]);
  const marked = host.filterBrowse({ highlights: true }, 40, { pdfList });
  assert.deepEqual(marked.rows.map((r) => r.uid), ["b2"], "only one.pdf has a highlight block");
  assert.equal(marked.rows[0].kind, "pdf");
  const withDays = host.filterBrowse({ highlights: true, days: 30 }, 40, { pdfList });
  assert.equal(browse.calls.length, 1, "with another filter the query runs (pdf pattern + window)");
  assert.deepEqual(withDays.rows.map((r) => r.uid), ["b2"]);
  assert.deepEqual(host.pdfFilter([libraryCard({ kind: "page", title: "Alpha" }), libraryCard({ kind: "block", uid: "b2", string: "{{[[pdf]]: https://x/one.pdf}}" })], { highlights: true }).map((r) => r.uid), ["b2"], "pdfFilter drops non-PDF rows");
});

test("host semanticRows: Parsed PDFs / highlights keep only Meaning rows that map to a passing PDF", () => {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedPage({ title: "Lab", uid: "lab", children: [
    { uid: "p1", string: "{{[[pdf]]: https://x/one.pdf}}", children: [{ uid: "h1", string: "a highlight under the first PDF, long enough" }] },
    { uid: "p2", string: "{{[[pdf]]: https://x/two.pdf}}" },
    { uid: "n1", string: "a plain note about sampling plans and things" },
  ] });
  fake.onQuery(/:pdf\/url \?url\] \[\?b :block\/page/, () => [["https://x/one.pdf", { ":pdf-highlight": {} }]]);
  // (The fake pull has no :block/parents, so the hit is the PDF block; hits under a PDF map to it in semantic.js.)
  const raw = [{ uid: "p1" }, { uid: "p2" }, { uid: "n1" }];
  const plain = host.semanticRows(raw, { text: "x" }, 40).rows.map((r) => r.string);
  assert.deepEqual(plain, ["((p1))", "((p2))", "((n1))"]);
  const marked = host.semanticRows(raw, { text: "x", highlights: true }, 40).rows;
  assert.deepEqual(marked.map((r) => r.string), ["((p1))"], "one.pdf has a highlight; the note and two.pdf go");
  assert.equal(marked[0].semantic, true);
  assert.equal(marked[0].kind, "pdf");
  const parsed = host.semanticRows(raw, { text: "x", parsed: true }, 40, { parsedUrls: new Set(["https://x/two.pdf"]) }).rows;
  assert.deepEqual(parsed.map((r) => r.string), ["((p2))"]);
});

// ---- panel

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const realTimers = { later: (fn, ms) => { const id = setTimeout(fn, ms); return () => clearTimeout(id); }, frame: () => () => {} };
function mount(on = {}, host = {}, timers = realTimers) {
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
const rowStrings = (root) => root.querySelectorAll(".pxd-panel__pane--search .pxd-panel__row").map((r) => r.dataset.string);
const empties = (root) => root.querySelectorAll(".pxd-panel__pane--search .pxd-panel__empty").map((n) => n.textContent);

test("panel: an empty box with a days value browses through filterBrowse, not librarySearch", async (t) => {
  const calls = [];
  const f = mount({}, {
    librarySearch() { calls.push("library"); return { rows: [], queries: [] }; },
    filterBrowse(filter, limit, opts) { calls.push({ filter, opts }); return { rows: [libraryCard({ kind: "page", title: "New page", uid: "n" })], queries: [{ name: "browse", ms: 4 }], spec: browseSpec(filter), defaulted: false }; },
  });
  t.after(f.restore);
  q(f.root, ".pxd-panel__days").value = "7";
  f.stub.dispatch(q(f.root, ".pxd-panel__input"), "keydown", { key: "Enter" });
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].filter.days, "7");
  assert.equal(calls[0].opts.keep, null);
  assert.deepEqual(rowStrings(f.root), ["[[New page]]"]);
  assert.equal(q(f.root, ".pxd-panel__list").getAttribute("data-browse"), "filter");
});

test("panel: filter changes wait 200 ms and run once; a superseded run does not paint", async (t) => {
  const calls = [];
  const f = mount({ userNames: () => ["Ann"] }, {
    async filterBrowse(filter) {
      calls.push(filter);
      const n = calls.length;
      await tick(n === 1 ? 60 : 0);
      return { rows: [libraryCard({ kind: "page", title: `Run ${n}`, uid: `u${n}` })], queries: [], spec: browseSpec(filter), defaulted: false };
    },
  });
  t.after(f.restore);
  f.stub.dispatch(q(f.root, ".pxd-panel__more-btn"), "click");
  const pop = q(f.root, ".pxd-panel__more-pop");
  const byLabel = (label) => pop.querySelectorAll("select, input").find((n) => n.getAttribute("aria-label") === label);
  const refs = byLabel("Has linked references");
  const kids = byLabel("Has children");
  refs.checked = true;
  f.stub.dispatch(refs, "change");
  kids.checked = true;
  f.stub.dispatch(kids, "change");
  await tick(FILTER_DEBOUNCE_MS / 2);
  assert.equal(calls.length, 0, "nothing while the user is still flipping filters");
  await tick(FILTER_DEBOUNCE_MS);
  assert.equal(calls.length, 1, "one run for both changes");
  assert.equal(calls[0].refs && calls[0].children, true);
  // A second change while the first run is still reading: the first run's rows never paint.
  const sel = byLabel("Created by");
  sel.value = "Ann";
  f.stub.dispatch(sel, "change");
  await tick(FILTER_DEBOUNCE_MS + 120);
  assert.equal(calls.length, 2);
  assert.deepEqual(rowStrings(f.root), ["[[Run 2]]"]);
});

test("panel: the default window line and the empty-state wording", async (t) => {
  let answer = null;
  const f = mount({}, { filterBrowse: (filter) => ({ ...answer, spec: browseSpec(filter), queries: [] }) });
  t.after(f.restore);
  const input = q(f.root, ".pxd-panel__input");
  const more = q(f.root, ".pxd-panel__more-btn");
  f.stub.dispatch(more, "click");
  const kids = q(f.root, ".pxd-panel__more-pop").querySelectorAll("input").find((n) => n.getAttribute("aria-label") === "Has children");
  kids.checked = true;
  answer = { rows: [libraryCard({ kind: "page", title: "P", uid: "p" })], defaulted: true };
  f.stub.dispatch(input, "keydown", { key: "Enter" });
  await tick();
  assert.deepEqual(empties(f.root), [DEFAULT_WINDOW_NOTE]);
  assert.deepEqual(rowStrings(f.root), ["[[P]]"]);
  answer = { rows: [], defaulted: true };
  f.stub.dispatch(input, "keydown", { key: "Enter" });
  await tick();
  assert.deepEqual(empties(f.root), ["Nothing edited in the last 30 days — set days to widen"]);
  kids.checked = false;
  const parsed = q(f.root, ".pxd-panel__more-pop").querySelectorAll("input").find((n) => n.getAttribute("aria-label") === "Parsed PDFs only");
  parsed.checked = true;
  answer = { rows: [], defaulted: false };
  f.stub.dispatch(input, "keydown", { key: "Enter" });
  await tick();
  assert.deepEqual(empties(f.root), ["No parsed PDFs"]);
});

test("panel: Parsed PDFs passes the parse store's urls and the PDF list; On this board passes the board's filter", async (t) => {
  const seen = [];
  const pdfList = () => [];
  const f = mount({ parsedUrls: async () => new Set(["https://x/one.pdf"]), pdfList, isOnBoard: (s) => s === "[[On]]" }, {
    filterBrowse(filter, limit, opts) { seen.push(opts); return { rows: [], queries: [], spec: browseSpec(filter), defaulted: false }; },
  });
  t.after(f.restore);
  const pop = q(f.root, ".pxd-panel__more-pop");
  const box = (label) => pop.querySelectorAll("input").find((n) => n.getAttribute("aria-label") === label);
  box("Parsed PDFs only").checked = true;
  box("On this board").checked = true;
  f.stub.dispatch(q(f.root, ".pxd-panel__input"), "keydown", { key: "Enter" });
  await tick();
  assert.deepEqual([...seen[0].parsedUrls], ["https://x/one.pdf"]);
  assert.equal(seen[0].pdfList, pdfList);
  assert.equal(seen[0].keep("[[On]]"), true);
  assert.equal(seen[0].keep("[[Off]]"), false);
});

test("panel: Meaning rows run with Parsed PDFs on and get the parse store's urls", async (t) => {
  const asked = [];
  const f = mount({
    parsedUrls: async () => new Set(["https://x/one.pdf"]),
    semantic: { enabled: () => true, peek: () => ({ data: [{ uid: "h1" }], stale: false }), search: async () => [] },
  }, {
    librarySearch: () => ({ rows: [], queries: [] }),
    pdfFilter: (rows) => rows,
    semanticRows(raw, filter, limit, opts) {
      asked.push({ filter, opts });
      return { rows: [{ ...libraryCard({ kind: "block", uid: "p1", string: "{{[[pdf]]: https://x/one.pdf}}" }), semantic: true }], queries: [] };
    },
  });
  t.after(f.restore);
  const box = q(f.root, ".pxd-panel__more-pop").querySelectorAll("input").find((n) => n.getAttribute("aria-label") === "Parsed PDFs only");
  box.checked = true;
  const input = q(f.root, ".pxd-panel__input");
  input.value = "sampling";
  f.stub.dispatch(input, "keydown", { key: "Enter" });
  await tick();
  assert.equal(asked.length, 1, "Meaning is no longer switched off by the PDF filters");
  assert.equal(asked[0].filter.parsed, true);
  assert.deepEqual([...asked[0].opts.parsedUrls], ["https://x/one.pdf"]);
  assert.ok(f.root.querySelectorAll(".pxd-panel__row--sem").length >= 1);
});

test("Meaning: with the PDF filters on, a hit on a Roam PDF page itself is that PDF's row", async () => {
  const { semanticCandidates, SEM_PULL } = await import("../src/model/semantic.js");
  assert.match(SEM_PULL, /^\[:block\/uid :block\/string :node\/title :pdf\/url /, "the page's own :pdf/url is pulled");
  const PDF = "{{[[pdf]]: https://x/one.pdf}}";
  const pull = (u) => (u === "pp" ? { ":block/uid": "pp", ":node/title": "A Cumulative Spore Killing Approach", ":pdf/url": "https://x/one.pdf" } : null);
  const pdfBlockOf = (url) => (url === "https://x/one.pdf" ? { uid: "p1", string: PDF, pageTitle: "Lab" } : null);
  const plain = semanticCandidates([{ uid: "pp" }], { pull, pdfBlockOf });
  assert.equal(plain[0].kind, "page", "without the filters the page stays a page (3.24 behaviour)");
  const mapped = semanticCandidates([{ uid: "pp" }], { pull, pdfBlockOf, pdfPages: true });
  assert.deepEqual([mapped[0].kind, mapped[0].uid, mapped[0].string], ["block", "p1", PDF]);
});
