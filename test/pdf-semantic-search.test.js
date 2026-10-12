// WO F: PDFs named by what they are, and Roam semantic search in the Add panel.
import assert from "node:assert/strict";
import test from "node:test";

import { createHost } from "../src/host/roam.js";
import { createSemantic, semanticEnabled } from "../src/host/semantic.js";
import { cleanAuthors, identFromLines, identFromParse, identHaystack, identMatches, looksLikeAuthors, markTerms, pdfRowName, pdfRowSub, venueText } from "../src/model/pdf-ident.js";
import { libraryCard } from "../src/model/library.js";
import { mergeSemantic, relatedQueryText, semanticCandidates } from "../src/model/semantic.js";
import { createPanel, SEMANTIC_HINT } from "../src/view/panel.js";
import { createPdfNames, IDENTS_KEY, readPdfIdent } from "../src/view/pdf-names.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const URL1 = "https://firebasestorage.googleapis.com/v0/b/x/o/imgs%2Fapp%2FReadwisenotes%2FrISmpBtsk7.pdf?alt=media&token=t";
const PDF1 = `{{[[pdf]]: ${URL1}}}`;

// Page 1 of the user's PDF (block kLoqLRwWq), as pdf.js lines.
const SPORE_LINES = [
  { text: "Open Forum Infectious Diseases", size: 12 },
  { text: "MAJORARTICLE", size: 12 },
  { text: "A Cumulative Spore Killing Approach: Synergistic", size: 21 },
  { text: "Sporicidal Activity of Dilute Peracetic Acid and Ethanol at", size: 21 },
  { text: "Low pH Against Clostridium difficile and Bacillus subtilis", size: 21 },
  { text: "Spores", size: 21 },
  { text: "Michelle M. Nerandzic, 1 Thriveen Sankar C, 2 Peter Setlow, 3 and Curtis J. Donskey 2,4", size: 8 },
  { text: "1 Research Service, Cleveland Veterans Affairs Medical Center, Ohio; 2 Case Western Reserve University", size: 7 },
  { text: "Background. Alcohol-based hand sanitizers are the primary method of hand hygiene in healthcare settings", size: 9.5 },
];
const SPORE_TITLE = "A Cumulative Spore Killing Approach: Synergistic Sporicidal Activity of Dilute Peracetic Acid and Ethanol at Low pH Against Clostridium difficile and Bacillus subtilis Spores";

const sporeIdent = () => identFromLines(SPORE_LINES, { pageTitle: "A Cumulative Spore Killing Approach: Synergistic Sporicidal Activity of Dilute…", pageCount: 7, metaTitle: "untitled" });

// ---- 1. identity derivation

test("page 1 gives the full title, the authors without affiliation marks, the venue, and the page count", () => {
  const id = sporeIdent();
  assert.equal(id.title, SPORE_TITLE);
  assert.equal(id.authors, "Michelle M. Nerandzic, Thriveen Sankar C, Peter Setlow, and Curtis J. Donskey");
  assert.equal(id.venue, "Open Forum Infectious Diseases");
  assert.equal(id.pages, 7);
  assert.ok(id.text.startsWith("Background. Alcohol-based"), "body words before affiliations");
  assert.ok(id.text.includes("Cleveland"), "affiliations still indexed");
});

test("without a page-title read the largest wordy type is the title; a table page has none", () => {
  const id = identFromLines([{ text: "Journal of Food Protection", size: 9 }, { text: "Listeria in dry blend rooms", size: 18 }, { text: "A. Smith and B. Jones", size: 9 }, { text: "Body text here.", size: 9 }], {});
  assert.equal(id.title, "Listeria in dry blend rooms");
  assert.equal(id.venue, "Journal of Food Protection");
  assert.equal(id.authors, "A. Smith and B. Jones");
  const table = identFromLines([{ text: "Amebiasis 2.38 1.90 1.41 1.35", size: 6 }, { text: "Anthrax 0.00 0.00", size: 5.5 }, { text: "Botulism 0.04", size: 5.5 }], {});
  assert.equal(table.title, "");
});

test("junk metadata titles never name a PDF; a real one is used only when nothing better is known", () => {
  assert.equal(identFromLines([], { metaTitle: "untitled" }).title, "");
  assert.equal(pdfRowName({ metaTitle: "Untitled", url: URL1 }).title, "PDF");
  assert.equal(pdfRowName({ metaTitle: "Microsoft Word - Sanitation SOP rev 4", url: URL1 }).title, "Sanitation SOP rev 4");
  assert.equal(pdfRowName({ metaTitle: "I", ident: sporeIdent(), url: URL1 }).title, SPORE_TITLE);
  // Order: own page → Roam PDF page → first-page read → parse → cover read → metadata → file name.
  const ident = sporeIdent();
  assert.equal(pdfRowName({ ownTitle: "Spore paper", pdfPageTitle: "PDF page", ident }).title, "Spore paper");
  assert.equal(pdfRowName({ pdfPageTitle: "Roam PDF -- Nerandzic -- OFID", parsedTitle: "Parsed", ident }).title, "Roam PDF");
  assert.equal(pdfRowName({ parsedTitle: "Parsed title here", coverTitle: "Cover", ident }).title, SPORE_TITLE, "the first-page read wins over a parse");
  assert.equal(pdfRowName({ parsedTitle: "Parsed title here", coverTitle: "Cover" }).title, "Parsed title here");
  assert.equal(pdfRowName({ coverTitle: "Cover title here", metaTitle: "Meta title here" }).title, "Cover title here");
  assert.equal(pdfRowName({ parsedTitle: "MA J O R A R T I C L E", coverTitle: "MAJOR ARTICLE", metaTitle: "Open forum", ident: { title: "MA J O R A R T I C L E" } }).title, "Open forum", "a banner never names a PDF");
  assert.equal(pdfRowName({ ownTitle: "imgs/app/Readwisenotes/rISmpBtsk7", ident }).title, SPORE_TITLE, "a storage-path page title is not a name");
  const waiting = pdfRowName({ url: URL1, pending: true });
  assert.deepEqual(waiting, { title: "PDF", loading: true });
  assert.equal(pdfRowName({ url: "https://x.test/Hand%20hygiene%20study.pdf", pending: true }).title, "Hand hygiene study");
});

test("authors, venue and label helpers", () => {
  assert.equal(looksLikeAuthors("Michelle M. Nerandzic, 1 Thriveen Sankar C, 2 Peter Setlow"), true);
  assert.equal(looksLikeAuthors("1 Research Service, Cleveland Veterans Affairs Medical Center, Ohio"), false);
  assert.equal(looksLikeAuthors("Alcohol-based hand sanitizers are the primary method of hand hygiene"), false);
  assert.equal(cleanAuthors("A. Smith 1,2 , B. Jones* and C. Lee†"), "A. Smith, B. Jones and C. Lee");
  assert.equal(venueText("MAJOR ARTICLE"), "");
  assert.equal(venueText("Science of the Total Environment 877 (2023) 162730"), "Science of the Total Environment");
  assert.equal(venueText("https://doi.org/10.1093/ofid/ofv123"), "");
});

test("a stored parse names the PDF without a fetch", () => {
  const doc = {
    numPages: 7,
    order: ["h", "a", "p"],
    blocks: {
      h: { type: "heading", level: 1, page: 1, text: SPORE_TITLE },
      a: { type: "para", page: 1, text: "Michelle M. Nerandzic, Peter Setlow, and Curtis J. Donskey" },
      p: { type: "para", page: 1, text: "Background. Alcohol-based hand sanitizers lack activity against spores." },
    },
  };
  const id = identFromParse(doc, { title: SPORE_TITLE });
  assert.equal(id.title, SPORE_TITLE);
  assert.equal(id.pages, 7);
  assert.match(id.authors, /Donskey/);
});

// ---- 2. index matching

test("the identity index matches title words, authors, venue and first words", () => {
  const id = sporeIdent();
  assert.equal(identMatches(id, ["spore killing"]), true);
  assert.equal(identMatches(id, ["peracetic"]), true);
  assert.equal(identMatches(id, ["donskey"]), true);
  assert.equal(identMatches(id, ["infectious", "sanitizers"]), true);
  assert.equal(identMatches(id, ["spore", "listeria"]), false);
  assert.equal(identMatches(null, ["spore"]), false);
  assert.ok(identHaystack(id).includes("open forum infectious diseases"));
  assert.deepEqual(markTerms("Spore killing spores", ["spore"]), [{ text: "Spore", hit: true }, { text: " killing ", hit: false }, { text: "spore", hit: true }, { text: "s", hit: false }]);
});

function hostWith({ pulls = {}, onQuery } = {}) {
  const fake = createFakeRoam();
  const orig = fake.api.data.pull;
  fake.api.data.pull = (pattern, entity) => {
    const uid = Array.isArray(entity) ? entity[1] : entity;
    return uid in pulls ? pulls[uid] : orig(pattern, entity);
  };
  const calls = [];
  fake.onQuery(/:find/, (query, ...inputs) => { calls.push(query); return onQuery ? onQuery(query, ...inputs) : []; });
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  return { fake, host, calls };
}

test("librarySearch finds a PDF by its identity text, ahead of the capped text queries, with every type on", () => {
  const { host, calls } = hostWith({
    onQuery: (query) => {
      if (query.includes("?kind") && query.includes("[?b :block/string ?s]") && !query.includes("?pat")) return [[PDF1, "kLoqLRwWq", "October 6th, 2026"], ["{{[[pdf]]: https://x.test/other.pdf}}", "other", "Lab"]];
      return [];
    },
  });
  const id = sporeIdent();
  const pdfMatch = (url, terms) => (url === URL1 && identMatches(id, terms) ? identHaystack(id) : "");
  const found = host.librarySearch({ text: "spore killing" }, 40, { pdfMatch });
  assert.deepEqual(found.rows.map((r) => r.string), ["((kLoqLRwWq))"]);
  assert.equal(found.rows[0].kind, "pdf");
  assert.equal(found.rows[0].uid, "kLoqLRwWq");
  assert.equal(found.rows[0].pageTitle, "October 6th, 2026");
  assert.equal(found.queries[0].name, "pdf-names");
  const author = host.librarySearch({ text: "donskey", types: ["pdf"], orphan: true }, 40, { pdfMatch });
  assert.deepEqual(author.rows.map((r) => r.string), ["((kLoqLRwWq))"]);
  assert.ok(calls.length > 0);
  const none = host.librarySearch({ text: "spore killing" }, 40);
  assert.deepEqual(none.rows, [], "without the index nothing names the PDF");
});

test("pdfNameInfo: a PDF that owns its page takes the page title; a daily page does not name it", () => {
  const { host } = hostWith({
    pulls: {
      own: { ":block/uid": "own", ":block/parents": [{ ":db/id": 1 }], ":block/page": { ":block/uid": "pg", ":node/title": "Spore paper", ":block/children": [{ ":block/uid": "own", ":block/string": PDF1, ":block/order": 0 }] } },
      daily: { ":block/uid": "daily", ":block/parents": [{ ":db/id": 1 }], ":block/page": { ":block/uid": "d", ":node/title": "October 6th, 2026", ":block/children": [{ ":block/uid": "daily", ":block/string": PDF1, ":block/order": 0 }] } },
      nested: { ":block/uid": "nested", ":block/parents": [{ ":db/id": 1 }, { ":db/id": 2 }], ":block/page": { ":block/uid": "pg2", ":node/title": "Notes", ":block/children": [] } },
    },
    onQuery: (query, url) => (query.includes(":pdf/url ?url") && url === URL1 ? [["hp", "Notes by [[Svy]]"], ["hp2", "Cumulative spore killing -- Nerandzic"]] : []),
  });
  assert.deepEqual(host.pdfNameInfo("own", ""), { ownTitle: "Spore paper", pdfPageTitle: "" });
  assert.deepEqual(host.pdfNameInfo("daily", URL1), { ownTitle: "", pdfPageTitle: "Cumulative spore killing -- Nerandzic" });
  assert.equal(host.pdfNameInfo("nested", "").ownTitle, "");
});

// ---- 3. row rendering

function panelSetup({ on = {}, host = {}, types = null, later = null } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const root = stub.document.createElement("div");
  root.className = "pxd-root";
  stub.document.body.append(root);
  const pending = [];
  const timers = {
    later: later || ((fn, ms) => { const job = { fn, ms, off: false }; pending.push(job); return () => { job.off = true; }; }),
    frame: () => () => {},
  };
  const panel = createPanel({ doc: stub.document, root, host, timers, on: { loadTypes: () => types, ...on } });
  const flush = async () => { for (let i = 0; i < 6; i += 1) { const jobs = pending.splice(0); for (const j of jobs) if (!j.off) await j.fn(); await tick(2); } };
  return { stub, restore, root, panel, flush, pending };
}
const qs = (root, sel) => root.querySelector(sel);
const type = async (f, text) => {
  const input = qs(f.root, ".pxd-panel__input");
  input.value = text;
  f.stub.dispatch(input, "keydown", { key: "Enter" });
  await tick(5);
};

const pdfCard = libraryCard({ kind: "block", uid: "kLoqLRwWq", string: PDF1, pageTitle: "October 6th, 2026" });

test("a PDF row shows the icon, its title with the query marked, and venue · pages · page", async (t) => {
  let ident = null;
  const f = panelSetup({
    types: ["pdf"],
    on: {
      pdfName: (card) => {
        const named = pdfRowName({ ident, url: card.url, pending: !ident });
        return { ...named, sub: pdfRowSub({ ident, pageTitle: card.pageTitle, title: named.title }) };
      },
      wantPdfNames: () => {},
      isOnBoard: () => false,
    },
    host: { librarySearch: () => ({ rows: [pdfCard], queries: [] }) },
  });
  t.after(f.restore);
  f.panel.open("search");
  await type(f, "spore");
  const row = qs(f.root, ".pxd-panel__row--pdf");
  assert.ok(row, "pdf row");
  assert.ok(qs(row, ".bp3-icon-document"));
  assert.equal(row.classList.contains("pxd-panel__row--loading"), true, "shimmer until named");
  assert.equal(qs(row, ".pxd-panel__row-title").textContent, "PDF");
  assert.equal(qs(row, ".pxd-panel__row-sub").textContent, "on October 6th, 2026");
  ident = sporeIdent();
  f.panel.refreshPdfNames([URL1]);
  const same = qs(f.root, ".pxd-panel__row--pdf");
  assert.equal(same, row, "swapped in place");
  assert.equal(row.classList.contains("pxd-panel__row--loading"), false);
  assert.equal(qs(row, ".pxd-panel__row-title").textContent, SPORE_TITLE);
  assert.equal(qs(row, ".pxd-panel__mark").textContent, "Spore");
  assert.equal(qs(row, ".pxd-panel__row-sub").textContent, "Open Forum Infectious Diseases · 7 pages · on October 6th, 2026");
  assert.equal(row.getAttribute("data-string"), "((kLoqLRwWq))", "drag/click payload unchanged");
});

test("visible PDF rows are asked for by name first; the whole PDF list only when PDFs are the filter", async (t) => {
  const asks = [];
  const f = panelSetup({
    types: ["pdf"],
    on: { pdfName: () => ({ title: "x", sub: "", loading: false }), wantPdfNames: (cards, opts) => asks.push([cards.map((c) => c.uid), opts]) },
    host: { librarySearch: () => ({ rows: [pdfCard], queries: [] }) },
  });
  t.after(f.restore);
  f.panel.open("search");
  await type(f, "x");
  assert.deepEqual(asks[0], [["kLoqLRwWq"], { front: true, all: true }]);
  const g = panelSetup({
    on: { pdfName: () => ({ title: "x", sub: "", loading: false }), wantPdfNames: (cards, opts) => asks.push([cards.map((c) => c.uid), opts]) },
    host: { librarySearch: () => ({ rows: [pdfCard], queries: [] }) },
  });
  t.after(g.restore);
  await type(g, "x");
  assert.equal(asks[1][1].all, false, "All types: only the visible rows");
});

test("a PDF named later that matches the typed words brings a quiet re-search", async (t) => {
  let named = false;
  let searches = 0;
  const f = panelSetup({
    types: ["pdf"],
    on: { pdfName: () => ({ title: "x", sub: "", loading: false }), wantPdfNames: () => {}, pdfMatch: (url, terms) => (named && terms.includes("spore") ? "spore" : "") },
    host: { librarySearch: () => { searches += 1; return { rows: named ? [pdfCard] : [], queries: [] }; } },
  });
  t.after(f.restore);
  f.panel.open("search");
  await type(f, "spore");
  assert.equal(searches, 1);
  named = true;
  f.panel.refreshPdfNames([URL1]);
  await f.flush();
  assert.equal(searches, 2);
  assert.ok(qs(f.root, ".pxd-panel__row--pdf"));
});

// ---- 4. semantic merge, dedupe, grouping, filters

const PULLS = {
  p1: { ":node/title": "Hand hygiene", ":block/uid": "p1" },
  c1: { ":block/uid": "c1", ":block/string": "Alcohol does not kill spores on hands at all", ":block/page": { ":block/uid": "long", ":node/title": "Long page" } },
  c2: { ":block/uid": "c2", ":block/string": "Peracetic acid at low pH is sporicidal", ":block/page": { ":block/uid": "long", ":node/title": "Long page" } },
  c3: { ":block/uid": "c3", ":block/string": "A third hit from the same long page", ":block/page": { ":block/uid": "long", ":node/title": "Long page" } },
  hl: { ":block/uid": "hl", ":block/string": "Highlight: spores survive ethanol", ":block/page": { ":block/uid": "pdfpage", ":node/title": "Spore paper", ":pdf/url": URL1 } },
  under: { ":block/uid": "under", ":block/string": "note under the pdf block", ":block/page": { ":block/uid": "d", ":node/title": "October 6th, 2026" }, ":block/parents": [{ ":block/uid": "d" }, { ":block/uid": "kLoqLRwWq", ":block/string": PDF1 }] },
  hdr: { ":block/uid": "hdr", ":block/string": "Examples", ":block/page": { ":block/uid": "x", ":node/title": "X" } },
  body: { ":block/uid": "body", ":block/string": "A longer body block chosen over the short header", ":block/page": { ":block/uid": "x", ":node/title": "X" } },
  css: { ":block/uid": "css", ":block/string": "code", ":block/page": { ":block/uid": "r", ":node/title": "roam/css" } },
};
const pullOf = (uid) => PULLS[uid] || null;

test("semantic candidates: rank order, two per page, PDF hits map to the PDF block, roam/ pages skipped", () => {
  const raw = [
    { type: "page", uid: "p1", topUids: [] },
    { type: "chunk", uid: "k1", topUids: ["c1"] },
    { type: "chunk", uid: "k2", topUids: ["c2"] },
    { type: "chunk", uid: "k3", topUids: ["c3"] },
    { type: "chunk", uid: "k4", topUids: ["hl"] },
    { type: "block", uid: "under", topUids: [] },
    { type: "chunk", uid: "k5", topUids: ["hdr", "body"] },
    { type: "chunk", uid: "k6", topUids: ["css"] },
    null,
    { type: "chunk", uid: "gone", topUids: ["missing"] },
  ];
  const rows = semanticCandidates(raw, { pull: pullOf, pdfBlockOf: (url) => (url === URL1 ? { uid: "kLoqLRwWq", string: PDF1, pageTitle: "October 6th, 2026" } : null) });
  assert.deepEqual(rows.map((r) => r.uid), ["p1", "c1", "c2", "kLoqLRwWq", "body"], "c3 capped (two per page); 'under' dedupes into the same PDF");
  assert.equal(rows[0].kind, "page");
  assert.equal(rows[3].via, "hl");
  assert.ok(rows.every((r) => r.semantic));
});

test("merge keeps keyword rows first and drops semantic duplicates", () => {
  const keyword = [{ string: "((c1))" }, { string: "[[Hand hygiene]]" }];
  const extra = mergeSemantic(keyword, [{ string: "[[Hand hygiene]]" }, { string: "((c2))" }, { string: "((c2))" }, { string: "((body))" }], 40);
  assert.deepEqual(extra.map((r) => r.string), ["((c2))", "((body))"]);
  assert.ok(extra.every((r) => r.semantic));
});

test("host.semanticRows applies type, tag, days and not-on-any-board to semantic hits", () => {
  const now = Date.now();
  const pulls = {
    a: { ":block/uid": "a", ":block/string": "spores on hands", ":edit/time": now, ":block/refs": [{ ":node/title": "hygiene" }], ":block/page": { ":block/uid": "pa", ":node/title": "A" } },
    b: { ":block/uid": "b", ":block/string": "old spores note", ":edit/time": now - 30 * 86400000, ":block/page": { ":block/uid": "pb", ":node/title": "B" } },
    pg: { ":block/uid": "pg", ":node/title": "Spores" },
    pdf: { ":block/uid": "pdf", ":block/string": PDF1, ":edit/time": now, ":block/page": { ":block/uid": "d", ":node/title": "October 6th, 2026" } },
    brd: { ":block/uid": "brd", ":block/string": "{{[[diagram]]: board}}", ":block/page": { ":block/uid": "pc", ":node/title": "C" } },
  };
  const { host } = hostWith({
    pulls,
    onQuery: (query) => (query.includes("[?u ...]") && query.includes("[?b :block/parents ?d]") ? [["a"]] : []),
  });
  const raw = ["a", "b", "pg", "pdf", "brd"].map((uid) => ({ type: "block", uid, topUids: [] }));
  const all = host.semanticRows(raw, {}, 40).rows;
  assert.deepEqual(all.map((r) => r.string), ["((a))", "((b))", "[[Spores]]", "((pdf))"], "board blocks skipped");
  assert.ok(all.every((r) => r.semantic));
  assert.equal(all[3].kind, "pdf");
  assert.deepEqual(host.semanticRows(raw, { types: ["pdf"] }).rows.map((r) => r.string), ["((pdf))"]);
  assert.deepEqual(host.semanticRows(raw, { tag: "hygiene" }).rows.map((r) => r.string), ["((a))"]);
  assert.deepEqual(host.semanticRows(raw, { days: 7, types: ["block"] }).rows.map((r) => r.string), ["((a))"]);
  assert.deepEqual(host.semanticRows(raw, { orphan: true, types: ["block"] }).rows.map((r) => r.string), ["((b))"]);
});

function semanticPanel({ enabled = true, raw = [], rowsOf = null, kw = [] } = {}) {
  const calls = [];
  const sem = createSemantic({
    api: () => ({ data: { semanticSearchEnabled: () => enabled, async: { semanticSearch: async (arg) => { calls.push(arg); return typeof raw === "function" ? raw(arg) : raw; } } } }),
  });
  const f = panelSetup({
    on: { semantic: sem, isOnBoard: (s) => s === "((c2))" },
    host: {
      librarySearch: () => ({ rows: kw, queries: [] }),
      semanticRows: (r, filter) => ({ rows: rowsOf ? rowsOf(r, filter) : r.map((x) => ({ string: `((${x.uid}))`, text: x.uid, kind: "block", label: "in X", semantic: true })), queries: [] }),
    },
  });
  return { f, calls, sem };
}

test("Meaning on: keyword rows paint first, then after the pause semantic rows with ≈ below them", async (t) => {
  const { f, calls } = semanticPanel({ raw: [{ uid: "c1" }, { uid: "c2" }, { uid: "kw" }], kw: [{ string: "((kw))", text: "keyword hit", kind: "block", label: "in K" }] });
  t.after(f.restore);
  f.panel.open("search");
  assert.notEqual(qs(f.root, ".pxd-panel__meaning").style.display, "none");
  await type(f, "spores on hands");
  assert.equal(f.root.querySelectorAll(".pxd-panel__row").length, 1, "keyword rows do not wait");
  assert.equal(calls.length, 0);
  assert.equal(f.pending.at(-1).ms <= 300, true);
  await f.flush();
  assert.deepEqual(calls, [{ "search-str": "spores on hands" }]);
  const rows = f.root.querySelectorAll(".pxd-panel__row");
  assert.deepEqual(rows.map((r) => r.getAttribute("data-string")), ["((kw))", "((c1))", "((c2))"]);
  assert.equal(f.root.querySelectorAll(".pxd-panel__sem").length, 2);
  assert.ok(qs(f.root, ".pxd-panel__sem-head"));
  assert.equal(rows[2].classList.contains("pxd-panel__row--on"), true, "already on this board: dimmed");
  // The same query again paints from the cache with no engine call.
  await type(f, "spores on hands");
  assert.equal(f.root.querySelectorAll(".pxd-panel__sem").length, 2);
  await f.flush();
  assert.equal(calls.length, 1);
});

test("Meaning off: no semantic call; a superseded query never paints", async (t) => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { f, calls } = semanticPanel({ raw: async (arg) => { if (arg["search-str"] === "first") await gate; return [{ uid: arg["search-str"] }]; } });
  t.after(f.restore);
  f.panel.open("search");
  await type(f, "first");
  const first = f.flush();
  await tick(5);
  await type(f, "second");
  release();
  await first;
  await f.flush();
  const strings = f.root.querySelectorAll(".pxd-panel__row").map((r) => r.getAttribute("data-string"));
  assert.deepEqual(strings, ["((second))"], "the first query's late answer is dropped");
  const box = qs(f.root, ".pxd-panel__meaning-box");
  box.checked = false;
  f.stub.dispatch(box, "click", {});
  await type(f, "third");
  await f.flush();
  assert.equal(calls.some((c) => c["search-str"] === "third"), false);
});

test("engine off or API missing: the toggle hides, the empty state hints, nothing throws", async (t) => {
  const { f, calls } = semanticPanel({ enabled: false });
  t.after(f.restore);
  f.panel.open("search");
  assert.equal(qs(f.root, ".pxd-panel__meaning").style.display, "none");
  f.panel.refreshPdfNames([]);
  const input = qs(f.root, ".pxd-panel__input");
  input.value = "";
  f.stub.dispatch(input, "keydown", { key: "Enter" });
  await tick(5);
  assert.equal(qs(f.root, ".pxd-panel__hint").textContent, SEMANTIC_HINT);
  await type(f, "spores");
  await f.flush();
  assert.equal(calls.length, 0);
  assert.equal(semanticEnabled(undefined), false);
  assert.equal(semanticEnabled({ data: { semanticSearchEnabled: () => { throw new Error("x"); } } }), false);
  assert.equal(semanticEnabled({ data: { semanticSearchEnabled: () => true } }), false, "no async.semanticSearch");
  const missing = createSemantic({ api: () => undefined });
  assert.deepEqual(await missing.search("x"), []);
});

// ---- 5. cache

test("semantic cache: 5 minutes fresh, stale served at once then refreshed, 50 queries kept, one call in flight per query", async () => {
  let t = 0;
  let n = 0;
  const api = { data: { semanticSearchEnabled: () => true, async: { semanticSearch: async () => { n += 1; return [{ uid: `r${n}` }]; } } } };
  const sem = createSemantic({ api: () => api, now: () => t });
  const [a, b] = await Promise.all([sem.search("q"), sem.search("q")]);
  assert.equal(n, 1, "deduped in flight");
  assert.deepEqual(a, b);
  t = 4 * 60 * 1000;
  assert.deepEqual(await sem.search("q"), [{ uid: "r1" }]);
  assert.equal(n, 1);
  t = 6 * 60 * 1000;
  assert.equal(sem.peek("q").stale, true);
  let fresh = null;
  const stale = await sem.search("q", { onFresh: (d) => { fresh = d; } });
  assert.deepEqual(stale, [{ uid: "r1" }], "stale while revalidate");
  await tick(2);
  assert.deepEqual(fresh, [{ uid: "r2" }]);
  for (let i = 0; i < 60; i += 1) await sem.search(`k${i}`);
  assert.equal(sem.report().cached, 50);
  assert.equal(sem.peek("q"), null, "oldest dropped");
});

// ---- 6. Find related

test("Find related query: title (not a daily title) + own text + first ten children, ≤600 chars, markup cleaned", () => {
  const kids = Array.from({ length: 14 }, (_, i) => `child **${i}** [[Link ${i}]]`);
  const q = relatedQueryText({ title: "Hand hygiene", string: "See ((abc)) and {{[[TODO]]}} #spores", children: kids });
  assert.ok(q.startsWith("Hand hygiene\nSee and spores\nchild 0 Link 0"));
  assert.ok(q.includes("child 9 Link 9"));
  assert.equal(q.includes("child 10"), false);
  assert.equal(relatedQueryText({ title: "October 6th, 2026", string: PDF1, children: ["x"] }), "x");
  assert.ok(relatedQueryText({ title: "a".repeat(900) }).length <= 600);
});

test("host.relatedText reads a page or block and its first children", () => {
  const { host } = hostWith({ pulls: { blk: { ":block/string": "Spore killing", ":block/children": [{ ":block/string": "second", ":block/order": 1 }, { ":block/string": "first", ":block/order": 0 }] } } });
  assert.equal(host.relatedText({ kind: "block", uid: "blk" }), "Spore killing\nfirst\nsecond");
  assert.equal(host.relatedText(null), "");
});

test("panel.findRelated shows semantic results for the card, without the card itself, marking ones on the board", async (t) => {
  const { f, calls } = semanticPanel({ raw: [{ uid: "self" }, { uid: "c1" }, { uid: "c2" }] });
  t.after(f.restore);
  f.panel.findRelated({ query: "Spore killing\nfirst", label: "Spore card", exclude: "((self))" });
  await tick(5);
  assert.deepEqual(calls, [{ "search-str": "Spore killing\nfirst" }]);
  assert.equal(qs(f.root, ".pxd-panel__rel .pxd-panel__like-text").textContent, "Related to: Spore card");
  const rows = f.root.querySelectorAll(".pxd-panel__row");
  assert.deepEqual(rows.map((r) => r.getAttribute("data-string")), ["((c1))", "((c2))"]);
  assert.equal(rows[1].classList.contains("pxd-panel__row--on"), true);
  assert.equal(f.root.querySelectorAll(".pxd-panel__sem").length, 0, "every row is by meaning here");
  f.stub.dispatch(qs(f.root, ".pxd-panel__rel .pxd-panel__like-x"), "click", {});
  await tick(5);
  assert.equal(qs(f.root, ".pxd-panel__rel").style.display, "none");
  assert.equal(f.panel.relatedQuery(), "");
  const off = semanticPanel({ enabled: false });
  t.after(off.f.restore);
  off.f.panel.findRelated({ query: "x" });
  await tick(5);
  assert.equal(qs(off.f.root, ".pxd-panel__hint").textContent, SEMANTIC_HINT);
});

// ---- 7. background reads

function fakePdfjs({ title = "untitled", delay = 0, log = [] } = {}) {
  const page = (n) => ({
    getViewport: () => ({ width: 600, height: 800, rotation: 0, transform: [1, 0, 0, -1, 0, 800] }),
    getTextContent: async () => ({
      items: n === 1 ? SPORE_LINES.map((l, i) => ({ str: l.text, transform: [l.size, 0, 0, l.size, 50, 760 - i * 30], width: l.text.length * l.size * 0.5, height: l.size, fontName: "f" })) : [],
      styles: { f: { fontFamily: "serif" } },
    }),
    getOperatorList: async () => ({ fnArray: [], argsArray: [] }),
  });
  return {
    log,
    getDocument: ({ url }) => {
      log.push(url);
      let destroyed = false;
      const pdf = { numPages: 7, getMetadata: async () => ({ info: { Title: title } }), getPage: async (n) => page(n), destroy: async () => { destroyed = true; } };
      return { promise: new Promise((r) => setTimeout(() => r(pdf), delay)), destroy: async () => { destroyed = true; }, get destroyed() { return destroyed; } };
    },
  };
}

test("readPdfIdent reads page 1 through pdf.js and refuses encrypted uploads", async () => {
  const lib = fakePdfjs();
  const id = await readPdfIdent(lib, URL1);
  assert.match(id.title, /^A Cumulative Spore Killing Approach/);
  assert.equal(id.pages, 7);
  assert.equal(id.meta, "untitled");
  assert.match(id.authors, /Donskey/);
  assert.equal(await readPdfIdent(lib, "https://x.test/a.pdf.enc"), null);
  assert.equal(lib.log.length, 1);
});

function memStore() {
  const meta = new Map();
  return { meta, getMeta: async (k) => meta.get(k) ?? null, putMeta: async (k, v) => { meta.set(k, v); return true; } };
}

test("pdf names: one read at a time, front of the queue first, parse before fetch, cached, stop aborts", async () => {
  const store = memStore();
  const order = [];
  let active = 0;
  let peak = 0;
  const read = async (lib, url, { signal }) => {
    active += 1;
    peak = Math.max(peak, active);
    order.push(url);
    await tick(5);
    active -= 1;
    if (signal?.aborted) return null;
    return { v: 2, title: `T ${url}`, authors: "", venue: "", pages: 1, text: "", meta: "" };
  };
  const changed = [];
  const names = createPdfNames({
    store,
    lib: () => ({}),
    readParse: async (url) => (url === "parsed" ? { doc: { numPages: 2, blocks: { h: { type: "heading", level: 1, page: 1, text: "Parsed Paper Title" } }, order: ["h"] }, title: "Parsed Paper Title" } : null),
    idle: (fn) => { const id = setTimeout(fn, 0); return () => clearTimeout(id); },
    onChange: (urls) => changed.push(...urls),
    read,
  });
  await names.want(["a", "b"]);
  await names.want(["c", "parsed"], { front: true });
  for (let i = 0; i < 40 && changed.length < 4; i += 1) await tick(5);
  assert.equal(peak, 1);
  assert.deepEqual(order, ["c", "a", "b"], "parsed needs no fetch; front-of-queue first");
  assert.equal(names.get("parsed").title, "Parsed Paper Title");
  assert.equal(names.get("parsed").from, "parse");
  assert.equal(names.known("a"), true);
  assert.deepEqual([...names.matchUrls(["t a"])], ["a"]);
  await tick(10);
  assert.ok(store.meta.get(IDENTS_KEY)?.items?.a, "persisted in the parse store meta");
  // A new instance reads the cache and fetches nothing.
  const again = createPdfNames({ store, read: async () => { throw new Error("no fetch"); }, idle: (fn) => { setTimeout(fn, 0); return () => {}; } });
  await again.want(["a", "b", "c"]);
  assert.equal(again.get("b").title, "T b");
  // stop(): the queue empties and the read in flight is aborted.
  const slow = [];
  const s = createPdfNames({ store: memStore(), lib: () => ({}), read: async (lib, url, { signal }) => { slow.push(url); await tick(20); return signal?.aborted ? null : { title: url }; }, idle: (fn) => { const id = setTimeout(fn, 0); return () => clearTimeout(id); } });
  await s.want(["x", "y", "z"]);
  await tick(5);
  s.stop();
  await tick(40);
  assert.deepEqual(slow, ["x"]);
  assert.equal(s.get("x"), null);
});

test("keyword results paint in budget with PDF naming on (performance.now)", async (t) => {
  const rows = Array.from({ length: 40 }, (_, i) => libraryCard({ kind: "block", uid: `p${i}`, string: `{{[[pdf]]: https://x.test/f${i}.pdf}}`, pageTitle: "Lab" }));
  const ident = sporeIdent();
  const f = panelSetup({
    types: ["pdf"],
    on: { pdfName: (card) => ({ ...pdfRowName({ ident, url: card.url }), sub: pdfRowSub({ ident, pageTitle: card.pageTitle }) }), wantPdfNames: () => {} },
    host: { librarySearch: () => ({ rows, queries: [] }) },
  });
  t.after(f.restore);
  const t0 = performance.now();
  await type(f, "spore");
  const ms = performance.now() - t0;
  assert.equal(f.root.querySelectorAll(".pxd-panel__row--pdf").length, 40);
  assert.ok(ms < 250, `40 named PDF rows painted in ${ms.toFixed(1)} ms`);
});

test("live PDF list cases: repository cover sheets, slug page names, junk running heads", async () => {
  const { pageNameOk } = await import("../src/model/pdf-ident.js");
  const cover = identFromLines([
    { text: "Lawrence Berkeley National Laboratory", size: 16 }, { text: "LBL Publications", size: 14 },
    { text: "Title", size: 12 }, { text: "Emerging supersolidity in photonic-crystal polariton condensates", size: 11 },
    { text: "Permalink", size: 12 }, { text: "https://escholarship.org/uc/item/4799h6nj", size: 11 },
    { text: "Journal", size: 12 }, { text: "Nature, 639(8054)", size: 11 },
    { text: "Authors", size: 12 }, { text: "Trypogeorgos, Dimitrios", size: 11 }, { text: "Gianfrate, Antonio", size: 11 },
  ], { pageTitle: "Lawrence Berkeley National Laboratory", pageCount: 13 });
  assert.equal(cover.title, "Emerging supersolidity in photonic-crystal polariton condensates");
  assert.equal(cover.venue, "Nature");
  assert.match(cover.authors, /Trypogeorgos/);
  assert.equal(looksLikeAuthors("LBL Publications"), false);
  assert.equal(cleanAuthors("Yilin Xiao ♠, Zhehan Zhu ♣, Hugo Touvron,∗"), "Yilin Xiao, Zhehan Zhu, Hugo Touvron");
  assert.equal(venueText("veröffentlicht in"), "");
  const sup = identFromLines([{ text: "Supplementary information", size: 10 }, { text: "Emerging supersolidity in condensates", size: 18 }], {});
  assert.equal(sup.venue, "");
  const rep = identFromLines([{ text: "The performance and psychological effects of goal", size: 16 }, { text: "The performance and psychological effects of goal setting", size: 16 }], { pageTitle: "The performance and psychological effects of goal" });
  assert.equal(rep.title, "The performance and psychological effects of goal", "a repeated running head does not double the title");
  assert.equal(pageNameOk("report-scan"), true);
  assert.equal(pageNameOk("cdc1980-p25-imageonly"), true);
  assert.equal(pageNameOk("rISmpBtsk7"), false);
  assert.equal(pageNameOk("imgs/app/Readwisenotes/rISmpBtsk7.pdf"), false);
  assert.equal(pdfRowName({ ownTitle: "report-scan" }).title, "report-scan");
});

test("an attribute line is not the shown hit when the chunk has text", () => {
  const pulls = {
    due: { ":block/uid": "due", ":block/string": "BT_attrDue:: [[October 12th, 2026]]", ":block/page": { ":block/uid": "p", ":node/title": "P" } },
    txt: { ":block/uid": "txt", ":block/string": "Alcohol hand rubs do not kill spores", ":block/page": { ":block/uid": "p", ":node/title": "P" } },
  };
  const rows = semanticCandidates([{ type: "chunk", uid: "k", topUids: ["due", "txt"] }, { type: "chunk", uid: "k2", topUids: ["due"] }], { pull: (u) => pulls[u] || null, perPage: 5 });
  assert.deepEqual(rows.map((r) => r.uid), ["txt", "due"]);
});

test("a board's connection lines are not semantic hits", () => {
  const pulls = {
    edge: { ":block/uid": "edge", ":block/string": "((YT8PkQ6ub)) → ((VwqXBfL3o))", ":block/page": { ":block/uid": "p", ":node/title": "P" }, ":block/parents": [{ ":block/uid": "p" }, { ":block/uid": "b", ":block/string": "{{[[diagram]]: lab}}" }, { ":block/uid": "c", ":block/string": "Connections" }] },
    card: { ":block/uid": "card", ":block/string": "Osmosis moves water across membranes", ":block/page": { ":block/uid": "p", ":node/title": "P" }, ":block/parents": [{ ":block/uid": "p" }, { ":block/uid": "b", ":block/string": "{{[[diagram]]: lab}}" }] },
  };
  const rows = semanticCandidates([{ type: "block", uid: "edge" }, { type: "block", uid: "card" }], { pull: (u) => pulls[u] || null });
  assert.deepEqual(rows.map((r) => r.uid), ["card"]);
});

test("with a cached PDF list the identity match runs no query; tag or days still query", () => {
  const { host, calls } = hostWith({ onQuery: () => [] });
  const id = sporeIdent();
  const pdfMatch = (url, terms) => (url === URL1 && identMatches(id, terms) ? identHaystack(id) : "");
  const pdfList = () => [{ uid: "kLoqLRwWq", string: PDF1, pageTitle: "October 6th, 2026", url: URL1 }];
  const found = host.librarySearch({ text: "peracetic", types: ["pdf"] }, 40, { pdfMatch, pdfList });
  assert.deepEqual(found.rows.map((r) => r.string), ["((kLoqLRwWq))"]);
  assert.equal(found.queries.some((q) => q.name === "pdf-names"), false);
  assert.equal(calls.some((q) => q.includes("?kind") && !q.includes("?pat")), false);
  host.librarySearch({ text: "peracetic", types: ["pdf"], days: 3 }, 40, { pdfMatch, pdfList });
  assert.equal(calls.some((q) => q.includes("?kind") && !q.includes("?pat")), true);
});
