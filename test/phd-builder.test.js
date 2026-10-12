// Pure parts of the PhD stress builder (tools/live/phd): blueprint validation, layout, uid mapping, the write plan,
// placeholder resolution and highlight text locating.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { uidFor, uidMap, UID_RE } from "../tools/live/phd/lib/uid.mjs";
import { validate, parseJsonl, parseHighlightRef } from "../tools/live/phd/lib/blueprint.mjs";
import { detectMode, placeBoard, tableSize, chartRows, overlaps } from "../tools/live/phd/lib/layout.mjs";
import { buildPlan, resolveString, refFor, libraryTitle, shapeOf } from "../tools/live/phd/lib/plan.mjs";
import { locate, locateLoose, normalizeKey, loadPdfText } from "../tools/live/phd/lib/pdftext.mjs";
import { levels, pendingHold } from "../tools/live/phd/lib/write.mjs";
import { refTitles, cutPlan } from "../tools/live/phd/cleanup.mjs";
import { phrases, rng, joinItems } from "../tools/live/phd/synth.mjs";
import { readPlexus, classifyString, parseEdgeLabel } from "../src/model/schema.js";
import { parseRegion } from "../src/model/regions.js";
import { parseTrailName } from "../src/model/trails.js";
import { parseSnapshot } from "../src/model/snapshots.js";

const src = (id, highlights = []) => ({ id, kind: "pdf", title: `Paper ${id}`, authors: ["Smith J"], year: 2020, highlights });
function mini() {
  return {
    meta: { schema: "pxd-phd/1", root: "PhD/Test root" },
    library: [src("S001", [{ page: 1, text: "spores survive drying", color: "red", note: "key" }, { page: 2, text: "biofilm on steel" }])],
    boards: [
      { id: "B0", title: "Map", parent: null, sections: [{ id: "A", title: "Lit", color: "blue", x: 0, y: 0, w: 1000, h: 800 }, { id: "A1", title: "Inner", x: 100, y: 400, w: 400, h: 300, parent: "A" }] },
      { id: "B1", title: "Chapter 1", parent: "B0", card: "K9", sections: [] },
    ],
    cards: [
      { id: "K1", board: "B0", section: "A", type: "note", text: "A note citing ((K2))", x: 40, y: 60 },
      { id: "K2", board: "B0", section: "A", type: "quote", source: "S001", highlight: 0, x: 400, y: 60 },
      { id: "K3", board: "B0", section: "A1", type: "table", table: { caption: "Swabs", rows: [["Site", "Result"], ["Z1", "neg"]] }, x: 120, y: 450 },
      { id: "K4", board: "B0", type: "pdf", source: "S001", x: 1200, y: 0 },
      { id: "K5", board: "B0", type: "quote", source: "S001", region: { page: 2, f: [0.1, 0.2, 0.5, 0.1] }, text: "Fig 2", x: 1500, y: 0 },
      { id: "K6", board: "B0", type: "image", image: { source: "S001", page: 1, crop: [0, 0, 1, 0.5] }, region: { f: [0.1, 0.1, 0.2, 0.2] }, text: "Plate", x: 1800, y: 0 },
      { id: "K7", board: "B0", type: "todo", text: "Write ch1", x: 2100, y: 0, comment: "Do it" },
      { id: "K9", board: "B0", type: "board", text: "Chapter 1", x: 0, y: 1000 },
      { id: "K10", board: "B1", type: "claim", text: "Inner claim", x: 0, y: 0 },
      { id: "K11", board: "B1", type: "pageref", text: "[[PhD/Concepts/Spores]]", x: 400, y: 0 },
    ],
    edges: [
      { id: "E1", from: "K1", to: "K2", label: "supports" },
      { from: "K3", to: "K4", fromCell: [1, 1], kind: "contradicts" },
      { from: "K7", to: "E1", label: "explains" },
      { from: "K10", to: "K11", both: true },
      { from: "K1", to: "K6", toRegion: true },
    ],
    extras: {
      views: [{ board: "B0", caption: "Lit view", cards: ["K1", "K2"] }],
      snapshots: [{ board: "B0" }],
      trails: [{ board: "B0", name: "Walk", stops: [{ card: "K1", note: "start" }, "K2"] }],
      notebook: [{ date: "2026-09-20", blocks: ["Worked on [[PhD/Test root]]"] }],
    },
  };
}

test("uids are deterministic, valid and salt-dependent", () => {
  const a = uidFor("s1", "card:K1");
  assert.match(a, UID_RE);
  assert.equal(a, uidFor("s1", "card:K1"));
  assert.notEqual(a, uidFor("s2", "card:K1"));
  assert.equal(uidMap("s1", ["x", "y", "x"]).size, 2);
});

test("validate accepts a good blueprint and counts it", () => {
  const v = validate(mini());
  assert.deepEqual(v.errors, []);
  assert.equal(v.counts.boards, 2);
  assert.equal(v.counts.depth, 2);
  assert.equal(v.counts.cards, 11 - 1);
  assert.equal(v.counts.highlights, 2);
  assert.equal(v.rootId, "B0");
});

test("validate reports broken references", () => {
  const bp = mini();
  bp.cards.push({ id: "K1", board: "B9", type: "nope" });
  bp.edges.push({ from: "K1", to: "K10" });
  bp.cards[1].highlight = 7;
  bp.boards[1].card = "K1";
  const v = validate(bp);
  assert.ok(v.errors.some((e) => /duplicate id K1/.test(e)));
  assert.ok(v.errors.some((e) => /highlight 7 out of range/.test(e)));
  assert.ok(v.errors.some((e) => /different boards/.test(e)));
  assert.ok(v.errors.some((e) => /want board/.test(e)));
});

test("jsonl parse and highlight refs", () => {
  assert.deepEqual(parseJsonl('{"a":1}\n\n{"a":2}\n'), [{ a: 1 }, { a: 2 }]);
  assert.throws(() => parseJsonl("{bad", "x.jsonl"), /x.jsonl:1/);
  assert.deepEqual(parseHighlightRef("S001:h3"), { source: "S001", index: 3 });
  assert.equal(parseHighlightRef("K12"), null);
});

test("layout: absolute coordinates become section-relative, nested sections too", () => {
  const bp = mini();
  const b0 = bp.boards[0];
  const cards = bp.cards.filter((c) => c.board === "B0");
  assert.equal(detectMode(b0, cards), "absolute");
  const geo = placeBoard(b0, cards);
  assert.deepEqual(geo.sections.get("A1"), { x: 100, y: 400, w: 400, h: 300 });
  assert.deepEqual(geo.cards.get("K3"), { x: 20, y: 50, w: tableSize(cards[2].table.rows).w, h: tableSize(cards[2].table.rows).h });
  const rel = { ...b0, sections: [{ id: "A", x: 500, y: 500, w: 600, h: 600 }] };
  assert.equal(detectMode(rel, [{ id: "c", type: "note", section: "A", x: 10, y: 10 }]), "relative");
  const auto = placeBoard({ id: "B", sections: [{ id: "S", x: 0, y: 0, w: 1000, h: 1000 }] }, [{ id: "a", type: "note", section: "S" }, { id: "b", type: "note", section: "S" }]);
  assert.notDeepEqual(auto.cards.get("a"), auto.cards.get("b"));
  assert.deepEqual(overlaps([{ id: "a", x: 0, y: 0, w: 10, h: 10, parent: "p" }, { id: "b", x: 5, y: 5, w: 10, h: 10, parent: "p" }, { id: "c", x: 5, y: 5, w: 10, h: 10, parent: "q" }]), [["a", "b"]]);
});

test("chart series become table rows", () => {
  assert.deepEqual(chartRows({ x: { label: "Q" }, series: [{ name: "Z2", points: [[1, 2], [2, 3]] }, { name: "Z3", points: [[2, 5]] }] }), [["Q", "Z2", "Z3"], ["1", "2", ""], ["2", "3", "5"]]);
});

test("plan writes Plexus's own shapes", () => {
  const plan = buildPlan(mini(), { salt: "t", today: new Date(2026, 9, 12) });
  const by = new Map(plan.ops.map((op) => [op.key, op]));
  const board = by.get("board:B0");
  assert.equal(board.string, "{{[[diagram]]:Map}}");
  assert.equal(readPlexus(board.props).v, 2);
  assert.equal(board.props["phd-stress"], 1);
  assert.equal(board.parent, plan.rootPage);
  const sec = by.get("sec:B0:A1");
  assert.equal(sec.parent, by.get("sec:B0:A").uid);
  assert.deepEqual(readPlexus(sec.props), { type: "section", x: 100, y: 400, w: 400, h: 300 });
  const k3 = by.get("card:K3");
  assert.equal(k3.parent, sec.uid);
  assert.equal(k3.open, false);
  assert.equal(by.get("table:K3").string, "{{[[table]]}}");
  assert.equal(by.get("cell:K3:1:1").parent, by.get("cell:K3:1:0").uid);
  assert.equal(by.get("card:K4").string, `[[${libraryTitle(mini().library[0])}]]`);
  assert.equal(classifyString(shapeOf(by.get("card:K2").string)).kind, "block");
  const pin = parseRegion(by.get("pin:K5").string);
  assert.equal(pin.kind, "pdf");
  assert.equal(pin.pg, 2);
  assert.equal(by.get("pins:S001").parent, plan.pdfs[0].pdfBlockUid);
  assert.equal(by.get("card:K5").string, `((${by.get("pin:K5").uid}))`);
  assert.equal(parseRegion(by.get("region:K6").string).kind, "img");
  assert.equal(by.get("card:K7").string, "{{[[TODO]]}} Write ch1");
  const nested = by.get("card:K9");
  assert.equal(readPlexus(nested.props).v, 2);
  assert.equal(by.get("card:K10").parent, nested.uid);
  assert.match(by.get("card:K1").string, new RegExp(`\\(\\(${by.get("card:K2").uid}\\)\\)`));
  // Edges: label in the string, endpoints in props; cell, edge-to-edge, two-way, region ends.
  const e1 = by.get("edge:E1");
  assert.equal(e1.parent, by.get("edges:B0").uid);
  assert.deepEqual(readPlexus(e1.props), { type: "edge", from: by.get("card:K1").uid, to: by.get("card:K2").uid });
  const cellEdge = plan.ops.find((op) => op.key.startsWith("edge:K3>K4"));
  assert.equal(readPlexus(cellEdge.props).fromBlock, by.get("cell:K3:1:1").uid);
  assert.equal(readPlexus(cellEdge.props).dash, "dashed");
  const toEdge = plan.ops.find((op) => op.key.startsWith("edge:K7>E1"));
  assert.equal(readPlexus(toEdge.props).to, e1.uid);
  assert.equal(readPlexus(plan.ops.find((op) => op.key.startsWith("edge:K10>K11")).props).dir, "two");
  assert.equal(readPlexus(plan.ops.find((op) => op.key.startsWith("edge:K1>K6")).props).toBlock, by.get("region:K6").uid);
  assert.equal(by.get("edges:B1").parent, nested.uid);
  // Extras.
  assert.equal(parseRegion(by.get("view:B0:0").string).kind, "view");
  assert.equal(parseSnapshot(readPlexus(by.get("snap:B0:0").props)).length, 2 + 8);
  assert.equal(parseTrailName(by.get("trail:B0:0").string), "Walk");
  assert.equal(by.get("stopnote:B0:0:0").string, "start");
  assert.equal(by.get("comments:root").string, "[[roam/comments]]");
  assert.equal(by.get("daily:09-20-2026").title, "September 20th, 2026");
  assert.equal(by.get("nb:0:0").props["phd-stress"], 1);
  assert.deepEqual(plan.warnings, []);
});

test("placeholders resolve, or fall back", () => {
  const plan = buildPlan(mini(), { salt: "t" });
  const by = new Map(plan.ops.map((op) => [op.key, op]));
  const ctx = { hl: (s, i) => (i === 0 ? "HLuid0001" : null), img: () => null, cardUid: (k) => by.get(`card:${k}`)?.uid, cardString: (k) => resolveString(by.get(`card:${k}`).string, ctx) ?? by.get(`card:${k}`).fallback };
  assert.equal(resolveString(by.get("card:K2").string, ctx), "((HLuid0001))");
  assert.equal(resolveString(by.get("card:K6").string, ctx), null);
  const e1 = resolveString(by.get("edge:E1").string, ctx);
  assert.equal(e1, `((${by.get("card:K1").uid})) → supports → ((HLuid0001))`);
  assert.equal(parseEdgeLabel(e1, `((${by.get("card:K1").uid}))`, "((HLuid0001))"), "supports");
  assert.equal(refFor("[[PhD/Library/X]]", "abc"), "[[PhD/Library/X]]");
  assert.equal(refFor("plain", "abcdefghi"), "((abcdefghi))");
});

test("levels put parents before children", () => {
  const ops = [
    { kind: "block", uid: "c", parent: "b" },
    { kind: "page", uid: "p" },
    { kind: "block", uid: "b", parent: "p" },
    { kind: "block", uid: "x", parent: "elsewhere" },
  ];
  assert.deepEqual(levels(ops).map((l) => l.map((o) => o.uid)), [["p"], ["b", "x"], ["c"]]);
});

test("cleanup knows which titles the build's refs could have created", () => {
  assert.deepEqual([...refTitles(["a [[X]] #tag and #[[Y Z]]", "{{[[TODO]]}} b"])].sort(), ["TODO", "X", "Y Z", "tag"]);
});

test("highlight text is located on the right page with line rects", async () => {
  const pdf = await loadPdfText(await readFile(new URL("./fixtures/pdf/journal.pdf", import.meta.url)));
  const one = locate(pdf.pages, "Novel risk assessment model of food quality and", 1);
  assert.equal(one.pageNumber, 1);
  assert.equal(one.rects.length, 1);
  assert.ok(Math.abs(one.boundingRect.x1 - 56.25) < 0.5 && Math.abs(one.boundingRect.x2 - 542.23) < 0.5, "matches Roam's own rect");
  assert.equal(one.boundingRect.width, 612);
  const two = locate(pdf.pages, "and pollutant indexes into one score. We weight each index", 3);
  assert.equal(two.pageNumber, 1);
  assert.equal(two.rects.length, 2);
  assert.equal(locate(pdf.pages, "this sentence is not in the paper at all", 1), null);
  assert.equal(normalizeKey("signiﬁcant – “x”"), 'significant"x"');
  // A running header inside the quote: the longest run that is on the page is highlighted.
  const loose = locateLoose(pdf.pages, "RUNNING HEADER Novel risk assessment model of food quality and", 1);
  assert.equal(loose.partial, true);
  assert.equal(loose.text, "Novel risk assessment model of food quality and");
  assert.equal(locateLoose(pdf.pages, "Novel risk assessment model of food quality and", 1).partial, false);
});

test("synth phrases are verbatim word windows", () => {
  const text = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone twentytwo";
  const out = phrases(text, rng(3), 5);
  assert.ok(out.length >= 1);
  for (const p of out) assert.ok(text.includes(p));
  assert.equal(joinItems([{ str: "Sal", transform: [1, 0, 0, 1, 0, 0], width: 10, height: 10 }, { str: "monella", transform: [1, 0, 0, 1, 10, 0], width: 30, height: 10, hasEOL: true }, { str: "grows", transform: [1, 0, 0, 1, 0, -12], width: 20, height: 10 }]), "Salmonella grows");
});

test("the mutation limiter keeps every 60 s window under budget", async () => {
  const { createLimiter } = await import("../tools/live/phd/lib/limit.mjs");
  let t = 0;
  const slept = [];
  const lim = createLimiter({ budget: 100, windowMs: 1000, now: () => t, sleep: async (ms) => { slept.push(ms); t += ms; } });
  await lim.take(60);
  await lim.take(40);
  assert.equal(slept.length, 0);
  await lim.take(10);
  assert.ok(t >= 1000, "waited for the first booking to leave the window");
  await lim.saturate();
  const before = t;
  await lim.take(1);
  assert.ok(t - before >= 1000);
  await lim.take(500);
  assert.ok(lim.used() <= 100);
});

test("cleanup cuts a big page into bounded subtrees", () => {
  const nodes = [
    { uid: "root", parent: null, size: 600 },
    { uid: "a", parent: "root", size: 300 },
    { uid: "a1", parent: "a", size: 150 },
    { uid: "a2", parent: "a", size: 149 },
    { uid: "b", parent: "root", size: 200 },
    { uid: "b1", parent: "b", size: 199 },
    { uid: "c", parent: "root", size: 99 },
    { uid: "small", parent: null, size: 3 },
  ];
  assert.deepEqual(cutPlan(nodes, 250).sort(), ["a1", "a2", "b", "c", "small"]);
});

test("writes hold on the age of Roam's oldest unconfirmed write, not only its capped count", () => {
  assert.equal(pendingHold(null), false);
  assert.equal(pendingHold({ n: 289, lagMs: 1800000 }), true);
  assert.equal(pendingHold({ n: 289, lagMs: 2000 }), false);
  assert.equal(pendingHold({ n: 400, lagMs: 0 }), true);
  assert.equal(pendingHold({ n: 0, lagMs: 99999 }), false);
  assert.equal(pendingHold({ n: 50, lagMs: 9000 }), false);
  assert.equal(pendingHold({ n: 50, lagMs: 9000 }, { resuming: true }), true);
});
