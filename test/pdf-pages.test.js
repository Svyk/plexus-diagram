// PDF cards that link the PDF's own page: resolver, migration planner, session apply, new uploads, highlight Ask.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildBoard } from "../src/model/board.js";
import { classifyString, semanticRef } from "../src/model/schema.js";
import { pdfMacroUrl } from "../src/model/pdf.js";
import {
  cleanPageTitle, inlinePdfCards, isPdfString, migrationLines, pageCardRef, pdfOfPageNode, pdfPageBaseTitle,
  pdfPageName, planPdfMigration, uniquePageTitle,
  looksRandomName, pdfNameFromRefs,
} from "../src/model/pdf-page.js";
import { highlightAsk, highlightImageUrl, highlightPart } from "../src/model/highlight-ask.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { buildMenu } from "../src/view/menu-model.js";
import { pdfFilesFromDataTransfer } from "../src/view/clipboard-io.js";

afterEach(() => resetSessions());

const URL_A = "https://firebasestorage.googleapis.com/v0/b/x/o/imgs%2Fapp%2FG%2FA1.pdf?alt=media&token=1";
const URL_B = "https://firebasestorage.googleapis.com/v0/b/x/o/imgs%2Fapp%2FG%2Fannual_report.pdf?alt=media&token=2";
const pdf = (url) => `{{[[pdf]]: ${url}}}`;

const pageNode = (title, uid, kids) => ({
  ":node/title": title,
  ":block/uid": uid,
  ":block/children": kids.map(([u, s, o]) => ({ ":block/uid": u, ":block/string": s, ":block/order": o })),
});

// ---- strings ----

test("pdf strings: both macro spellings classify as pdf and give the url", () => {
  assert.equal(isPdfString(pdf(URL_A)), true);
  assert.equal(isPdfString(`{{pdf: ${URL_A}}}`), true);
  assert.equal(isPdfString("[[pdf]] notes"), false);
  assert.equal(classifyString(`{{pdf: ${URL_A}}}`).kind, "pdf");
  assert.equal(pdfMacroUrl(`{{pdf: ${URL_A}}}`), URL_A);
  assert.equal(pdfMacroUrl(pdf(URL_A)), URL_A);
});

test("pageCardRef: [[Title]] and [label]([[Title]]), nothing else", () => {
  assert.deepEqual(pageCardRef("[[Risk model]]"), { title: "Risk model", label: "" });
  assert.deepEqual(pageCardRef("[Short]([[Risk model -- Han -- 84a5]])"), { title: "Risk model -- Han -- 84a5", label: "Short" });
  assert.equal(pageCardRef("[[A]] and [[B]]"), null);
  assert.equal(pageCardRef("[[A [[B]]]]"), null);
  assert.equal(pageCardRef("plain"), null);
});

test("pdfOfPageNode: the first top-level pdf block by order", () => {
  const node = pageNode("Doc", "pg1", [["n1", "Notes by [[Svy]]", 1], ["p2", pdf(URL_B), 2], ["p1", `{{pdf: ${URL_A}}}`, 0]]);
  assert.deepEqual(pdfOfPageNode(node), { pageUid: "pg1", title: "Doc", pdfUid: "p1", string: `{{pdf: ${URL_A}}}` });
  assert.equal(pdfOfPageNode(pageNode("Doc", "pg1", [["n1", "Notes by [[Svy]]", 0]])), null);
  assert.equal(pdfOfPageNode(null), null);
});

test("titles: Roam's long PDF title shows its first part; new titles are clean and never collide", () => {
  assert.equal(pdfPageName("Novel risk model -- Yongming Han; Jiaxin Liu -- Science -- 10_1016 -- 84a551fd"), "Novel risk model");
  assert.equal(pdfPageName("report"), "report");
  assert.equal(cleanPageTitle("  [[A]]\nB #x "), "A B x");
  assert.equal(pdfPageBaseTitle({ display: "PDF", fileName: "cdc1980_p25.pdf" }), "cdc1980 p25");
  assert.equal(pdfPageBaseTitle({ display: "Annual report 2024" }), "Annual report 2024");
  assert.equal(pdfPageBaseTitle({ now: new Date(2026, 9, 11, 9).getTime() }), "PDF 2026-10-11");
  const taken = new Set(["Report", "Report (2)"]);
  assert.equal(uniquePageTitle("Report", (t) => taken.has(t)), "Report (3)");
  assert.equal(uniquePageTitle("Fresh", (t) => taken.has(t)), "Fresh");
});

// ---- resolver in buildBoard ----

function boardNode(children) {
  return { ":block/uid": "b1", ":block/string": "{{[[diagram]]}}", ":block/props": { ":plexus": { ":v": 2 } }, ":block/children": children };
}
const card = (uid, string, order, x = 0, extra = {}) => ({
  ":block/uid": uid, ":block/string": string, ":block/order": order,
  ":block/props": { ":plexus": { ":type": "card", ":x": x, ":y": 0, ":w": 240, ":h": 320 } }, ...extra,
});

test("resolver: a [[page]] card whose page holds a pdf block is a pdf card that targets the pdf block", () => {
  const pages = new Map([["Doc A", { pageUid: "pgA", title: "Doc A", pdfUid: "pdfA", string: pdf(URL_A) }]]);
  const asked = [];
  const b = buildBoard(boardNode([card("c1", "[[Doc A]]", 0), card("c2", "[[Plain page]]", 1, 300), card("c3", "[Alias]([[Doc A]])", 2, 600)]), {
    pdfOfPage: (t) => { asked.push(t); return pages.get(t) || null; },
  });
  const c1 = b.items.get("c1");
  assert.equal(c1.kind, "pdf");
  assert.deepEqual(c1.target, { kind: "block", uid: "pdfA", page: "Doc A", pageUid: "pgA" });
  assert.equal(c1.title, "Doc A");
  assert.equal(semanticRef(c1), "[[Doc A]]");
  const c2 = b.items.get("c2");
  assert.equal(c2.kind, "page");
  assert.deepEqual(c2.target, { kind: "page", title: "Plain page" });
  const c3 = b.items.get("c3");
  assert.equal(c3.kind, "pdf");
  assert.equal(c3.title, "Alias");
  assert.deepEqual(asked.sort(), ["Doc A", "Doc A", "Plain page"]);
});

test("resolver: a page carried by the board pull is read from the pull, not asked for", () => {
  const embedded = pageNode("Doc A", "pgA", [["n1", "Notes by [[Svy]]", 1], ["pdfA", pdf(URL_A), 0]]);
  embedded[":block/children"][1][":block/children"] = [{ ":block/uid": "pins", ":block/string": "{{[[plexus-pins]]}}", ":block/order": 0 }];
  const b = buildBoard(boardNode([card("c1", "[[Doc A]]", 0, 0, { ":block/refs": [embedded] })]), {
    pdfOfPage: () => { throw new Error("must not read"); },
  });
  assert.equal(b.items.get("c1").kind, "pdf");
  assert.equal(b.items.get("c1").target.uid, "pdfA");
  assert.deepEqual(b.items.get("c1").content.map((k) => k[":block/uid"]), ["pins"]);
});

test("resolver: old-style pdf cards are unchanged (target self)", () => {
  const b = buildBoard(boardNode([card("p1", pdf(URL_A), 0)]), { pdfOfPage: () => null });
  const p1 = b.items.get("p1");
  assert.equal(p1.kind, "pdf");
  assert.deepEqual(p1.target, { kind: "self", uid: "p1" });
  assert.equal(inlinePdfCards(b).length, 1);
});

// ---- planner ----

function fakeBoard() {
  // Section "PDFS" holds two old-style PDFs; a third sits at the top level. Two connections touch them.
  const section = {
    ":block/uid": "sec", ":block/string": "PDFS", ":block/order": 0, ":block/heading": 1,
    ":block/props": { ":plexus": { ":type": "section", ":x": 0, ":y": 0, ":w": 900, ":h": 600 } },
    ":block/children": [card("pA", pdf(URL_A), 0, 10), card("pB", pdf(URL_B), 1, 300)],
  };
  const note = { ":block/uid": "n1", ":block/string": "a note", ":block/order": 1, ":block/props": { ":plexus": { ":type": "card", ":x": 1000, ":y": 0 } } };
  const third = card("pA2", pdf(URL_A), 2, 1400);
  const edges = {
    ":block/uid": "E", ":block/string": "Connections", ":block/order": 3, ":block/props": { ":plexus": { ":type": "edges" } },
    ":block/children": [
      { ":block/uid": "e1", ":block/string": "((pA)) → cites → ((n1))", ":block/order": 0, ":block/props": { ":plexus": { ":type": "edge", ":from": "pA", ":to": "n1" } } },
      { ":block/uid": "e2", ":block/string": "((n1)) → ((pB))", ":block/order": 1, ":block/props": { ":plexus": { ":type": "edge", ":from": "n1", ":to": "pB" } } },
      { ":block/uid": "e3", ":block/string": "((n1)) → ((n1))", ":block/order": 2, ":block/props": { ":plexus": { ":type": "edge", ":from": "n1", ":to": "n1" } } },
    ],
  };
  return buildBoard(boardNode([section, note, third, edges]));
}

function planDeps(overrides = {}) {
  let n = 0;
  return {
    graph: "g",
    urlOf: (item) => pdfMacroUrl(item.string),
    layoutOf: (uid) => ({ type: "card", x: uid === "pA" ? 10 : 300, y: 0, w: 240, h: 320, color: "blue" }),
    findPage: () => null,
    pageExists: () => false,
    titleFor: (item) => (item.uid === "pA" ? "Paper A" : "PDF"),
    newUid: () => `u${++n}`,
    ...overrides,
  };
}

test("planner: moves each old-style pdf, copies layout, rewrites only the touching connections", () => {
  const plan = planPdfMigration(fakeBoard(), planDeps());
  assert.equal(plan.boardUid, "b1");
  assert.equal(plan.graph, "g");
  assert.deepEqual(plan.moves.map((m) => [m.pdfUid, m.parentUid, m.order, m.page.title, m.page.reuse]), [
    ["pA", "sec", 0, "Paper A", false],
    ["pB", "sec", 1, "annual report", false],
  ]);
  const a = plan.moves[0];
  assert.equal(a.cardString, "[[Paper A]]");
  assert.deepEqual(a.layout, { type: "card", x: 10, y: 0, w: 240, h: 320, color: "blue" });
  assert.ok(a.cardUid && a.page.newUid && a.cardUid !== a.page.newUid);
  // pA2 is the same file as pA: it stays on the board.
  assert.deepEqual(plan.skipped, [{ pdfUid: "pA2", title: "PDF", reason: "same-file" }]);
  assert.deepEqual(plan.edges, [
    { uid: "e1", from: a.cardUid, to: "n1", string: "[[Paper A]] → cites → ((n1))" },
    { uid: "e2", from: "n1", to: plan.moves[1].cardUid, string: "((n1)) → [[annual report]]" },
  ]);
  assert.ok(migrationLines(plan).some((l) => l.includes("2 connections")));
});

test("planner: an existing page for the same file is reused; a taken title gets a suffix", () => {
  const plan = planPdfMigration(fakeBoard(), planDeps({
    findPage: ({ url }) => (url === URL_B ? { uid: "roamPg", title: "B2 -- Author -- 84a5", why: "sha" } : null),
    pageExists: (t) => t === "Paper A",
  }));
  assert.equal(plan.moves[0].page.title, "Paper A (2)");
  assert.deepEqual(plan.moves[1].page, { uid: "roamPg", title: "B2 -- Author -- 84a5", reuse: true, why: "sha" });
  assert.equal(plan.moves[1].cardString, "[[B2 -- Author -- 84a5]]");
});

test("planner: a page that already holds another pdf block is not used; the card stays", () => {
  const plan = planPdfMigration(fakeBoard(), planDeps({
    findPage: ({ url }) => (url === URL_A ? { uid: "pg", title: "Paper A", pdfUid: "someOtherPdf" } : null),
  }));
  assert.deepEqual(plan.moves.map((m) => m.pdfUid), ["pB"]);
  assert.equal(plan.skipped.find((s) => s.pdfUid === "pA").reason, "page-has-pdf");
});

test("planner: idempotent, a board with only page cards plans nothing", () => {
  const b = buildBoard(boardNode([card("c1", "[[Doc A]]", 0)]), { pdfOfPage: () => ({ pageUid: "pg", title: "Doc A", pdfUid: "pdfA", string: pdf(URL_A) }) });
  const plan = planPdfMigration(b, planDeps());
  assert.deepEqual([plan.moves, plan.edges, plan.skipped], [[], [], []]);
});

// ---- session apply over the fake Roam ----

function seeded() {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  host.graphName = () => "g";
  fake.seedPage({ title: "Lab", uid: "lab", children: [] });
  fake.seedBoard({
    uid: "b1",
    parent: "lab",
    props: { plexus: { v: 2 } },
    children: [
      {
        uid: "sec", string: "PDFS", heading: 1, props: { plexus: { type: "section", x: 0, y: 0, w: 900, h: 600 } },
        children: [
          { uid: "pA", string: pdf(URL_A), props: { plexus: { type: "card", x: 10, y: 20, w: 240, h: 320 }, "plexus-reads": { k: 1 } }, children: [{ uid: "pinbox", string: "{{[[plexus-pins]]}}" }] },
          { uid: "n0", string: "between", props: { plexus: { type: "card", x: 400, y: 20 } } },
        ],
      },
      { uid: "n1", string: "a note", props: { plexus: { type: "card", x: 1000, y: 0 } } },
      {
        uid: "E", string: "Connections", props: { plexus: { type: "edges" } }, open: false,
        children: [{ uid: "e1", string: "((pA)) → cites → ((n1))", props: { plexus: { type: "edge", from: "pA", to: "n1" } } }],
      },
    ],
  });
  const session = acquireSession("b1", { host, raf: (fn) => fn(), linkDelay: 0, settings: { "graph-links": "off" } });
  return { fake, host, session };
}

function sessionPlan(session, host, overrides = {}) {
  return planPdfMigration(session.board, planDeps({
    layoutOf: (id) => session.layoutOf(id),
    findPage: ({ url }) => host.findPdfPage({ url }),
    pageExists: (t) => host.pageExists(t),
    newUid: () => host.generateUid(),
    ...overrides,
  }));
}

test("session: the pdf block moves to the top of a new page, the card and edge follow, one group", async () => {
  const { fake, host, session } = seeded();
  const plan = sessionPlan(session, host);
  assert.equal(plan.moves.length, 1);
  const m = plan.moves[0];
  fake.clearLog();
  const res = await session.movePdfsToPages(plan);
  await fake.flush?.();
  assert.equal(res.moved, 1);
  assert.equal(res.edges, 1);
  // The page exists with the pdf block (same uid, children kept) first.
  const pageUid = m.page.newUid;
  assert.deepEqual(fake.children(pageUid), ["pA"]);
  assert.deepEqual(fake.children("pA"), ["pinbox"]);
  // Layout props left the pdf block; other props stayed.
  const props = fake.props("pA");
  assert.equal(props.plexus, undefined);
  assert.deepEqual(props["plexus-reads"], { k: 1 });
  // The card took the pdf block's place in the section, with its layout.
  assert.deepEqual(fake.children("sec"), [m.cardUid, "n0"]);
  assert.equal(fake.block(m.cardUid).string, "[[Paper A]]");
  assert.equal(fake.props(m.cardUid).plexus.x, 10);
  // The connection now names the page and ends at the new card.
  assert.equal(fake.block("e1").string, "[[Paper A]] → cites → ((n1))");
  assert.equal(fake.props("e1").plexus.from, m.cardUid);
  // The board sees a pdf card that targets the moved block.
  const item = session.board.items.get(m.cardUid);
  assert.equal(item.kind, "pdf");
  assert.equal(item.target.uid, "pA");
  // Pins stay under the pdf block; the card reads them from there.
  assert.deepEqual(item.content.map((k) => k[":block/uid"]), ["pinbox"]);
  assert.equal(session.board.edges.get("e1").valid, true);
  // Order of writes: page, then the moves and the card.
  const kinds = fake.writesLog().map((e) => e[0]);
  assert.equal(kinds[0], "page-create");
  assert.ok(kinds.includes("move") && kinds.includes("create"));
  // A second run plans and writes nothing.
  const again = sessionPlan(session, host);
  assert.equal(again.moves.length, 0);
  fake.clearLog();
  const res2 = await session.movePdfsToPages(plan);
  assert.equal(res2.moved, 0);
  assert.equal(fake.writesLog().length, 0);
});

test("session: refuses a plan for another graph or another board", async () => {
  const { fake, host, session } = seeded();
  const plan = sessionPlan(session, host);
  fake.clearLog();
  assert.deepEqual(await session.movePdfsToPages({ ...plan, graph: "other" }), { moved: 0, refused: "graph" });
  assert.deepEqual(await session.movePdfsToPages({ ...plan, boardUid: "b2" }), { moved: 0, refused: "board" });
  assert.equal(fake.writesLog().length, 0);
});

test("session: reuses Roam's own PDF page found by url; no page is created", async () => {
  const { fake, host, session } = seeded();
  fake.seedPage({ title: "Paper A -- Han -- 84a5", uid: "roamPg", children: [{ uid: "notesby", string: "Notes by [[Svy]]" }] });
  fake.onQuery(/:pdf\/url \?url/, (q, url) => (url === URL_A ? [["roamPg", "Paper A -- Han -- 84a5"]] : []));
  const plan = sessionPlan(session, host);
  assert.equal(plan.moves[0].page.reuse, true);
  fake.clearLog();
  await session.movePdfsToPages(plan);
  assert.deepEqual(fake.children("roamPg"), ["pA", "notesby"]);
  assert.ok(!fake.writesLog().some((e) => e[0] === "page-create"));
  const item = session.board.items.get(plan.moves[0].cardUid);
  assert.equal(item.kind, "pdf");
  assert.equal(item.title, "Paper A");
});

test("session: a new upload writes the page, its pdf block first, and a [[page]] card", async () => {
  const { fake, host, session } = seeded();
  fake.clearLog();
  const ids = await session.addPdfPageCards([{ title: "Upload one", newPage: true, pageUid: "newPg", url: URL_B, x: 2000, y: 0 }]);
  assert.equal(ids.length, 1);
  const kids = fake.children("newPg");
  assert.equal(kids.length, 1);
  assert.equal(fake.block(kids[0]).string, pdf(URL_B));
  assert.equal(fake.block(ids[0]).string, "[[Upload one]]");
  const item = session.board.items.get(ids[0]);
  assert.equal(item.kind, "pdf");
  assert.equal(item.target.uid, kids[0]);
  assert.equal(host.pdfOfPage("Upload one")?.pdfUid, kids[0]);
  // findPdfPage: a page whose top-level pdf block has this url (Roam's :pdf/url query finds nothing here).
  fake.onQuery(/\[\?p :block\/children \?b\]/, (q, url) => (url === URL_B ? [["newPg", "Upload one"]] : []));
  assert.deepEqual(host.findPdfPage({ url: URL_B }), { uid: "newPg", title: "Upload one", pdfUid: kids[0], why: "page" });
  assert.equal(host.findPdfPage({ url: URL_A }), null);
  // An existing page for the file: only the card is written.
  fake.clearLog();
  const again = await session.addPdfPageCards([{ title: "Upload one", x: 2000, y: 400 }]);
  assert.equal(again.length, 1);
  assert.deepEqual(fake.writesLog().map((e) => e[0]), ["create"]);
});

// ---- highlights ----

const textHl = { type: "text", text: "the selected passage", image: false, page: 3, note: "" };
const areaHl = { type: "area", text: "", image: true, page: 2, note: "chart" };
const AREA_STRING = "![](https://firebasestorage.googleapis.com/x/zqJy0wsTc.png?alt=media) #h/yellow";

test("highlight focus: text highlight with a parse sends the selection and its page", () => {
  const parsed = { blocks: { b1: { id: "b1", type: "para", page: 3, text: "Before. the selected passage. After." } }, order: ["b1"] };
  const ask = highlightAsk({ highlight: textHl, string: "the selected passage #h/yellow", uid: "h1", parsed });
  assert.equal(ask.doc, parsed);
  assert.deepEqual(ask.focus, { selection: "the selected passage", page: 3 });
  assert.equal(ask.image, null);
  assert.deepEqual(ask.source, { sourceUid: "h1" });
});

test("highlight focus: text highlight with no parse stands alone", () => {
  const ask = highlightAsk({ highlight: textHl, uid: "h1", title: "Doc" });
  assert.deepEqual(ask.focus, { blockId: "sel", selection: "the selected passage" });
  assert.equal(ask.doc.blocks.sel.page, 3);
});

test("highlight focus: an area highlight sends its snapshot as the figure image", () => {
  assert.equal(highlightImageUrl(AREA_STRING), "https://firebasestorage.googleapis.com/x/zqJy0wsTc.png?alt=media");
  const parsed = { blocks: { b1: { id: "b1", type: "para", page: 2, text: "x" } }, order: ["b1"] };
  const withParse = highlightAsk({ highlight: areaHl, string: AREA_STRING, uid: "h2", parsed });
  assert.deepEqual(withParse.focus, { page: 2 });
  assert.equal(withParse.image.url, "https://firebasestorage.googleapis.com/x/zqJy0wsTc.png?alt=media");
  assert.match(withParse.image.caption, /chart/);
  const bare = highlightAsk({ highlight: areaHl, string: AREA_STRING, uid: "h2" });
  assert.deepEqual(bare.focus, { blockId: "img" });
  assert.equal(highlightAsk({ highlight: areaHl, string: "no image", uid: "h2" }), null);
  assert.equal(highlightAsk({ highlight: { ...textHl, text: "" } }), null);
});

test("highlight part: keyed by the highlight uid so two areas stay two parts", () => {
  const a = highlightPart(highlightAsk({ highlight: areaHl, string: AREA_STRING, uid: "h2" }), { uid: "h2", pdfUid: "card", url: URL_A });
  const b = highlightPart(highlightAsk({ highlight: areaHl, string: AREA_STRING, uid: "h3" }), { uid: "h3", pdfUid: "card", url: URL_A });
  assert.notEqual(a.key, b.key);
  assert.equal(a.pdfUid, "card");
  assert.ok(a.image);
  assert.deepEqual(a.source, { sourceUid: "h2" });
});

// ---- menus and drops ----

test("menus: the board menu offers the move only with old-style PDFs; highlight cards can be asked about", () => {
  const ids = (items) => items.map((i) => i.id);
  assert.ok(ids(buildMenu("board-menu", { inlinePdfs: 2 })).includes("pdf-pages"));
  assert.ok(!ids(buildMenu("board-menu", { inlinePdfs: 0 })).includes("pdf-pages"));
  const hl = ids(buildMenu("card", { isHighlight: true, item: { kind: "highlight" } }));
  assert.ok(hl.includes("ask-ai") && hl.includes("add-to-ask"));
});

test("drop: PDF files are picked out of a drop by type or by name", () => {
  const a = { type: "application/pdf", name: "a.pdf" };
  const b = { type: "", name: "b.PDF" };
  const c = { type: "image/png", name: "c.png" };
  assert.deepEqual(pdfFilesFromDataTransfer({ files: [a, b, c] }), [a, b]);
  assert.deepEqual(pdfFilesFromDataTransfer(null), []);
});

test("host: findPdfPage matches Roam's :pdf/content-hash (sha256 of the file) and ignores a bad hash", () => {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  const sha = "c33435c01afe7b3d".padEnd(64, "0");
  fake.seedPage({ title: "report", uid: "rp", children: [{ uid: "nb", string: "Notes by [[Svy]]" }] });
  const route = fake.onQuery(/:pdf\/content-hash/, (q, h) => (h === sha ? [["rp", "report"]] : []));
  assert.deepEqual(host.findPdfPage({ sha: sha.toUpperCase() }), { uid: "rp", title: "report", pdfUid: "", why: "sha" });
  assert.equal(host.findPdfPage({ sha: "nothex" }), null);
  assert.equal(route.calls.length, 1);
});

// ---- migration page titles ----

const TODAY = new Date(2026, 9, 11, 9).getTime();

test("titles: no ellipsis, no namespace slash, no Roam syntax (the live EC 2073/2005 title)", () => {
  const live = "COMMISSION REGULATION (EC) No 2073/2005 of 15 November 2005 on microbiological\u2026";
  assert.equal(pdfPageBaseTitle({ display: live }), "COMMISSION REGULATION (EC) No 2073-2005 of 15 November 2005 on microbiological");
  assert.equal(cleanPageTitle("A/B"), "A-B");
  assert.equal(cleanPageTitle("Part 1 / Part 2"), "Part 1 - Part 2");
  assert.equal(cleanPageTitle("a... b"), "a b");
  assert.equal(cleanPageTitle("[[Ref]] #tag {{x}} ((uid)) `c` ^^h^^ **b** __i__ k::v"), "Ref tag x uid c h b i k v");
});

test("titles: long titles are cut at a word boundary within 100 characters, without an ellipsis", () => {
  const long = "Guidance for industry on the control of Listeria monocytogenes in ready-to-eat foods and related surveillance programs";
  const t = pdfPageBaseTitle({ display: long });
  assert.ok(t.length <= 100, String(t.length));
  assert.ok(long.startsWith(t));
  assert.equal(long[t.length], " ");
  assert.ok(!t.includes("\u2026") && !t.includes("..."));
  assert.equal(t, "Guidance for industry on the control of Listeria monocytogenes in ready-to-eat foods and related");
});

test("titles: sources go parsed title, alias, a file name in a referring block, a real url name, then PDF date", () => {
  assert.equal(pdfPageBaseTitle({ display: "Annual report 2024", alias: "Alias", refs: ["x.pdf"], fileName: "real_name.pdf" }), "Annual report 2024");
  assert.equal(pdfPageBaseTitle({ display: "PDF", alias: "My alias", refs: ["x.pdf"], fileName: "real_name.pdf" }), "My alias");
  assert.equal(pdfPageBaseTitle({ display: "PDF", alias: "", refs: ["report-scan.pdf: Fixture page 3"], fileName: "real_name.pdf" }), "report-scan");
  assert.equal(pdfPageBaseTitle({ display: "Untitled", refs: ["no file here", "see Lab_Notes.PDF today"], fileName: "" }), "Lab Notes");
  assert.equal(pdfPageBaseTitle({ display: "PDF", refs: [], fileName: "real_name.pdf", now: TODAY }), "real name");
  assert.equal(pdfPageBaseTitle({ display: "PDF", refs: [], fileName: "Y Wx3LSX7k", now: TODAY }), "PDF 2026-10-11");
  assert.equal(pdfPageBaseTitle({ display: "PDF", fileName: "", now: TODAY }), "PDF 2026-10-11");
  assert.equal(pdfPageBaseTitle({ display: "ab", fileName: "", now: TODAY }), "PDF 2026-10-11");
});

test("titles: random storage names are recognised; page-card refs and urls are not names", () => {
  assert.equal(looksRandomName("Y_Wx3LSX7k"), true);
  assert.equal(looksRandomName("Y Wx3LSX7k"), true);
  assert.equal(looksRandomName("zqJy0wsTc"), true);
  assert.equal(looksRandomName("cdc1980_p25"), false);
  assert.equal(looksRandomName("annual report"), false);
  assert.equal(pdfNameFromRefs(["{{[[pdf]]: https://x/y/abc.pdf}}", "((uid12345)) cites it"]), "");
  assert.equal(pdfNameFromRefs(["report-scan.pdf: Fixture"]), "report-scan");
});

test("planner: scanned PDFs get dated titles with a plain suffix, never PDF (2); refs and alias feed the title", () => {
  const plan = planPdfMigration(fakeBoard(), planDeps({
    titleFor: () => "PDF",
    urlOf: (item) => (item.uid === "pA" ? "https://x/o/imgs%2Fapp%2FG%2FY_Wx3LSX7k.pdf?alt=media" : pdfMacroUrl(item.string)),
    refsOf: (item) => (item.uid === "pB" ? ["report-scan.pdf: Fixture"] : []),
    now: () => TODAY,
  }));
  assert.deepEqual(plan.moves.map((m) => m.page.title), ["PDF 2026-10-11", "report-scan", "PDF 2026-10-11 (2)"]);
  const two = planPdfMigration(fakeBoard(), planDeps({ titleFor: () => "PDF", urlOf: (item) => `https://x/o/${item.uid}Z9.pdf`, now: () => TODAY }));
  assert.deepEqual(two.moves.map((m) => m.page.title), ["PDF 2026-10-11", "PDF 2026-10-11 (2)", "PDF 2026-10-11 (3)"]);
  assert.ok(!two.moves.some((m) => m.page.title === "PDF (2)"));
});

// ---- undo and redo of the whole migration ----

test("undo: three PDFs, the first onto an EXISTING page: one undo restores every pdf block, props and order; redo migrates again", async () => {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  host.graphName = () => "g";
  fake.seedPage({ title: "Lab", uid: "lab", children: [] });
  fake.seedPage({ title: "report", uid: "rep", children: [{ uid: "repNote", string: "Notes by [[Svy]]" }] });
  const urls = ["https://x/o/report.pdf", "https://x/o/Beta Study.pdf", "https://x/o/Gamma Study.pdf"];
  const pdfKid = (uid, i) => ({ uid, string: pdf(urls[i]), props: { plexus: { type: "card", x: 10 + i * 300, y: 20, w: 240, h: 320 }, ...(i ? { "plexus-reads": { k: i } } : {}) } });
  fake.seedBoard({
    uid: "b1",
    parent: "lab",
    props: { plexus: { v: 2 } },
    children: [
      { uid: "sec", string: "PDFS", heading: 1, props: { plexus: { type: "section", x: 0, y: 0, w: 1200, h: 600 } }, children: [pdfKid("q0", 0), { uid: "n0", string: "between", props: { plexus: { type: "card", x: 5, y: 500 } } }, pdfKid("q1", 1), pdfKid("q2", 2)] },
      { uid: "n1", string: "a note", props: { plexus: { type: "card", x: 1000, y: 0 } } },
      { uid: "E", string: "Connections", props: { plexus: { type: "edges" } }, open: false, children: [{ uid: "e1", string: "((q0)) → cites → ((n1))", props: { plexus: { type: "edge", from: "q0", to: "n1" } } }] },
    ],
  });
  fake.trackUndo = true;
  const session = acquireSession("b1", { host, raf: (fn) => fn(), linkDelay: 0, settings: { "graph-links": "off" } });
  const snap = () => ({
    sec: fake.children("sec"),
    rep: fake.children("rep"),
    props: Object.fromEntries(["q0", "q1", "q2"].map((u) => [u, JSON.stringify(fake.props(u))])),
    edge: [fake.block("e1").string, JSON.stringify(fake.props("e1"))],
  });
  const before = snap();
  const plan = sessionPlan(session, host, {
    findPage: ({ url }) => (url === urls[0] ? { uid: "rep", title: "report", why: "url" } : null),
    titleFor: (item) => ({ q0: "report", q1: "Beta Study", q2: "Gamma Study" })[item.uid] || "PDF",
  });
  assert.equal(plan.moves.length, 3);
  assert.equal(plan.moves[0].page.reuse, true);
  const res = await session.movePdfsToPages(plan);
  assert.equal(res.moved, 3);
  const after = snap();
  assert.deepEqual(fake.children("rep").slice(0, 2), ["q0", "repNote"]);
  assert.ok(!after.sec.includes("q0") && !after.sec.includes("q1") && !after.sec.includes("q2"));
  await session.undo();
  assert.deepEqual(snap(), before);
  assert.equal(fake.block("q0").parent, "sec");
  assert.ok(plan.moves.every((m) => !fake.block(m.cardUid)), "every new card is gone");
  await session.redo();
  assert.deepEqual(snap(), after);
  await session.undo();
  assert.deepEqual(snap(), before);
});
