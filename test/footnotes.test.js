import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { toRoamMarkdown } from "../src/model/parse-to-roam-md.js";
import { toGridSpec } from "../src/model/parse-to-grid.js";
import { createParseActions } from "../src/view/parse-actions.js";
import { handleParseDrop } from "../src/model/drop.js";
import {
  FN_CLOSE, FN_OPEN, aliasFor, defLine, hasFootnoteTokens, normalizeMark, pageNoteBlocks, planFootnotes, plainFootnotes, prepareTable, refToken,
} from "../src/model/footnotes.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";

afterEach(() => {
  resetSessions();
  delete globalThis.roamGrid;
});

const ALIAS = /#sup\^\^\[\((\d+)\)\]\(\(\(([^)]+)\)\)\)\^\^/g;

test("marks normalize: superscripts, brackets, dots, symbols", () => {
  assert.equal(normalizeMark("(¹)"), "1");
  assert.equal(normalizeMark("ᵃ"), "a");
  assert.equal(normalizeMark("[b]"), "b");
  assert.equal(normalizeMark("1."), "1");
  assert.equal(normalizeMark("**"), "**");
  assert.equal(normalizeMark("†"), "†");
});

test("planFootnotes numbers by first reference after startAt and links uids", () => {
  const md = [
    `- Alpha ${refToken("n2", "2")} beta ${refToken("n1", "1")}`,
    defLine("n1", "1", "First note"),
    defLine("n2", "2", "Second note"),
  ].join("\n");
  let k = 0;
  const plan = planFootnotes([md], { startAt: 3, uid: () => `U${++k}` });
  assert.deepEqual(plan.notes.map((n) => [n.n, n.uid, n.text]), [[4, "U1", "Second note"], [5, "U2", "First note"]]);
  assert.equal(plan.apply(md), "- Alpha #sup^^[(4)](((U1)))^^ beta #sup^^[(5)](((U2)))^^");
});

test("planFootnotes cap keeps extra notes as plain (N) lines in place", () => {
  const refs = [1, 2, 3].map((i) => `${refToken(`n${i}`, String(i))}`).join(" ");
  const md = [`- Text ${refs}`, defLine("n1", "1", "A"), defLine("n2", "2", "B"), defLine("n3", "3", "C")].join("\n");
  const plan = planFootnotes([md], { cap: 2, uid: (() => { let i = 0; return () => `U${++i}`; })() });
  assert.equal(plan.notes.length, 2);
  assert.equal(plan.overflow.length, 1);
  assert.equal(plan.apply(md), "- Text #sup^^[(1)](((U1)))^^ #sup^^[(2)](((U2)))^^ (3)\n- (3) C");
});

test("a reference without a note keeps the PDF's mark; an unreferenced note stays a line", () => {
  const md = [`- See ${refToken("gone", "7")}`, defLine("lone", "*", "Orphan")].join("\n");
  const plan = planFootnotes([md], { uid: () => "U" });
  assert.equal(plan.notes.length, 0);
  assert.equal(plan.apply(md), "- See [7]\n- [*] Orphan");
  assert.equal(hasFootnoteTokens([md]), true);
  assert.equal(hasFootnoteTokens(["- plain"]), false);
});

test("alias format matches the extension, with and without superscript", () => {
  assert.equal(aliasFor(1, "abc", true), "#sup^^[(1)](((abc)))^^");
  assert.equal(aliasFor(12, "abc", false), "[(12)](((abc)))");
});

function para(id, text, refs) {
  return { id, type: "para", page: 1, text, footnoteRefs: refs };
}
function note(id, mark, text) {
  return { id, type: "footnote", page: 1, mark, text };
}

test("toRoamMarkdown extension format puts tokens in paragraphs and a def line per note", () => {
  const doc = {
    order: ["p1", "f1"],
    blocks: {
      p1: para("p1", "Cases rose¹ in March.", [{ mark: "1", at: 10, to: "f1" }]),
      f1: note("f1", "1", "Provisional counts."),
    },
  };
  const out = toRoamMarkdown(doc, ["p1", "f1"], { footnoteFormat: "extension" }).markdown;
  assert.equal(out, `- Cases rose${refToken("f1", "1")} in March.\n${defLine("f1", "1", "Provisional counts.")}`);
  const plan = planFootnotes([out], { uid: () => "N1" });
  assert.equal(plan.apply(out), "- Cases rose#sup^^[(1)](((N1)))^^ in March.");
  assert.equal(plan.notes[0].text, "Provisional counts.");
});

test("toRoamMarkdown finds a note outside the selection through the whole parse", () => {
  const doc = {
    order: ["p1", "f1"],
    blocks: {
      p1: para("p1", "Rate*", [{ mark: "*", at: 4, to: "f1" }]),
      f1: note("f1", "*", "Per 100,000."),
    },
  };
  const out = toRoamMarkdown(doc, ["p1"], { footnoteFormat: "extension" }).markdown;
  assert.ok(out.includes(refToken("f1", "*")));
  assert.ok(out.includes(defLine("f1", "*", "Per 100,000.")));
  const end = toRoamMarkdown(doc, ["p1"], { footnoteFormat: "extension", footnotes: "end" }).markdown;
  assert.equal(end.split("\n").length, 2);
});

test("toRoamMarkdown plain format numbers inside the insert; off is the old output", () => {
  const doc = {
    order: ["p1", "f1"],
    blocks: {
      p1: para("p1", "Cases rose¹ in March.", [{ mark: "1", at: 10, to: "f1" }]),
      f1: note("f1", "1", "Provisional counts."),
    },
  };
  assert.equal(toRoamMarkdown(doc, ["p1", "f1"], { footnoteFormat: "plain" }).markdown, "- Cases rose(1) in March.\n- (1) Provisional counts.");
  assert.equal(toRoamMarkdown(doc, ["p1", "f1"], { footnoteFormat: "off" }).markdown, "- Cases rose[1] in March.\n- [1] Provisional counts.");
  assert.equal(toRoamMarkdown(doc, ["p1", "f1"]).markdown, "- Cases rose[1] in March.\n- [1] Provisional counts.");
});

function notesTable() {
  const cells = [
    { r: 0, c: 0, text: "Disease" }, { r: 0, c: 1, text: "Cases" },
    { r: 1, c: 0, text: "Rubella congenital syndrome**" }, { r: 1, c: 1, text: "1,000ᵃ" },
    { r: 2, c: 0, text: "Pertussis (1)" }, { r: 2, c: 1, text: "2,500" },
    { r: 3, c: 0, text: "Measles" }, { r: 3, c: 1, text: "40" },
    { r: 4, c: 0, text: "** Congenital rubella cases only.", colSpan: 2 },
    { r: 5, c: 0, text: "a. Provisional.", colSpan: 2 },
  ];
  return { id: "t1", type: "table", page: 1, rows: 6, cols: 2, headerRows: 1, cells };
}

test("prepareTable: note rows under the table become tokens; mapped cells keep the rest of the text", () => {
  const avail = [{ id: "f9", mark: "1", text: "Notifiable since 1922." }];
  const prep = prepareTable(notesTable(), avail, { format: "extension" });
  assert.equal(prep.table.rows, 4);
  assert.equal(prep.table.cells.length, 8);
  const text = (r, c) => prep.table.cells.find((x) => x.r === r && x.c === c).text;
  assert.equal(text(1, 0), `Rubella congenital syndrome${refToken("t1:row:4", "**")}`);
  assert.equal(text(1, 1), `1,000${refToken("t1:row:5", "a.")}`);
  assert.equal(text(2, 0), `Pertussis${refToken("f9", "1")}`);
  assert.deepEqual(prep.notes.map((n) => [n.id, n.text]), [["t1:row:4", "Congenital rubella cases only."], ["t1:row:5", "Provisional."], ["f9", "Notifiable since 1922."]]);
});

test("prepareTable: nothing matches, nothing changes; unreferenced note rows stay", () => {
  const t = { id: "t2", type: "table", rows: 2, cols: 1, headerRows: 0, cells: [{ r: 0, c: 0, text: "Plain 5" }, { r: 1, c: 0, text: "* Orphan note." }] };
  const prep = prepareTable(t, [], { format: "extension" });
  assert.equal(prep.table, t);
  assert.equal(prep.notes.length, 0);
  assert.equal(prepareTable(t, [{ id: "x", mark: "*", text: "n" }], { format: "off" }).table, t);
});

test("prepareTable plain: (N) in cells and one merged note row per note", () => {
  const prep = prepareTable(notesTable(), [{ id: "f9", mark: "1", text: "Notifiable." }], { format: "plain" });
  assert.equal(prep.notes.length, 0);
  assert.equal(prep.table.rows, 7);
  const text = (r, c) => prep.table.cells.find((x) => x.r === r && x.c === c)?.text;
  assert.equal(text(1, 0), "Rubella congenital syndrome(1)");
  assert.equal(text(1, 1), "1,000(2)");
  assert.equal(text(2, 0), "Pertussis(3)");
  assert.equal(text(4, 0), "(1) Congenital rubella cases only.");
  assert.equal(prep.table.cells.find((x) => x.r === 6).colSpan, 2);
  assert.equal(text(6, 0), "(3) Notifiable.");
});

test("grid spec carries tokens and still right-aligns the numeric column", () => {
  const prep = prepareTable(notesTable(), [], { format: "extension" });
  const spec = toGridSpec(prep.table);
  assert.ok(spec.rows[1][1].includes(FN_OPEN));
  assert.deepEqual(spec.alignments, [{ col: 1, align: "right" }]);
  assert.equal(FN_CLOSE.length, 1);
});

test("pageNoteBlocks keeps footnotes of the table's page", () => {
  const doc = { order: ["a", "b", "c"], blocks: { a: note("a", "1", "one"), b: { id: "b", type: "footnote", page: 2, mark: "1", text: "two" }, c: para("c", "x") } };
  assert.deepEqual(pageNoteBlocks(doc, { page: 1 }), [{ id: "a", mark: "1", text: "one" }]);
});

// ---- session ------------------------------------------------------------------------------

function setup({ settings = {}, pageChildren = [] } = {}) {
  const fake = createFakeRoam();
  const data = fake.api.data;
  const pull = data.pull;
  const pageOf = (uid) => {
    let cur = uid;
    while (fake.block(cur)?.parent) cur = fake.block(cur).parent;
    return fake.block(cur) ? null : cur;
  };
  data.pull = (pattern, entity) => {
    const out = pull(pattern, entity);
    if (out && String(pattern).includes(":block/page") && Array.isArray(entity)) {
      const page = pageOf(entity[1]);
      if (page && page !== entity[1]) out[":block/page"] = { ":block/uid": page };
    }
    return out;
  };
  const created = [];
  const create = data.block.create;
  data.block.create = (arg) => { created.push(structuredClone(arg)); return create(arg); };
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedPage({
    uid: "page1",
    title: "Lab",
    children: [
      { uid: "b1", string: "{{[[diagram]]}}", props: { plexus: { v: 2 } }, children: [{ uid: "c1", string: "note", props: { plexus: { x: 0, y: 0, w: 280, h: 160 } } }] },
      { uid: "pdf1", string: "{{[[pdf]]: http://x/y.pdf}}" },
      ...pageChildren,
    ],
  });
  const session = acquireSession("b1", { host, linkDelay: 0, settings });
  return { fake, host, session, created };
}

const cardMd = (id, mark, body, note) => `- ${body}${refToken(id, mark)}\n${defLine(id, mark, note)}`;
const pageTop = (fake) => fake.children("page1").map((uid) => fake.block(uid));

test("card insert creates the rule and header once, notes with pre-generated uids, one undo group", async () => {
  const { fake, session, created } = setup();
  const res = await session.insertParsedCard({ x: 10, y: 10, markdown: cardMd("n1", "1", "Alpha", "Note one") });
  assert.equal(res.ok, true);
  const top = pageTop(fake);
  const tail = top.slice(-2);
  assert.equal(tail[0].string, "---");
  assert.equal(tail[1].string, "#footnotes");
  const header = created.find((c) => c.block.string === "#footnotes");
  assert.equal(header.block["children-view-type"], "numbered");
  const kids = fake.children(tail[1].uid).map((u) => fake.block(u));
  assert.deepEqual(kids.map((k) => k.string), ["Note one"]);
  const card = fake.block(res.uid);
  const m = [...card.string.matchAll(ALIAS)];
  assert.equal(m.length, 1);
  assert.equal(m[0][1], "1");
  assert.equal(m[0][2], kids[0].uid);
  assert.equal(res.writes, 5);
});

test("a second insert continues the numbering and reuses the header", async () => {
  const { fake, session } = setup();
  await session.insertParsedCard({ x: 10, y: 10, markdown: cardMd("n1", "1", "Alpha", "Note one") });
  const res = await session.insertParsedCard({ x: 10, y: 400, markdown: `${cardMd("n2", "1", "Beta", "Note two")}` });
  const headers = pageTop(fake).filter((b) => b.string === "#footnotes");
  assert.equal(headers.length, 1);
  assert.equal(pageTop(fake).filter((b) => b.string === "---").length, 1);
  const kids = fake.children(headers[0].uid).map((u) => fake.block(u));
  assert.deepEqual(kids.map((k) => k.string), ["Note one", "Note two"]);
  const alias = [...fake.block(res.uid).string.matchAll(ALIAS)][0];
  assert.equal(alias[1], "2");
  assert.equal(alias[2], kids[1].uid);
});

test("numbering continues after the highest alias already on the page", async () => {
  const { fake, session } = setup({ pageChildren: [{ string: "Earlier #sup^^[(7)](((zzz)))^^" }] });
  const res = await session.insertParsedCard({ x: 10, y: 10, markdown: cardMd("n1", "1", "Alpha", "Note") });
  const alias = [...fake.block(res.uid).string.matchAll(ALIAS)][0];
  assert.equal(alias[1], "8");
});

test("an existing header takes the new notes without a second rule", async () => {
  const { fake, session, created } = setup({ pageChildren: [{ uid: "fh", string: "#footnotes", children: [{ string: "Old one" }, { string: "Old two" }] }] });
  const res = await session.insertParsedCard({ x: 10, y: 10, markdown: cardMd("n1", "1", "Alpha", "Fresh") });
  assert.equal(created.filter((c) => c.block.string === "---").length, 0);
  assert.equal(created.filter((c) => c.block.string === "#footnotes").length, 0);
  assert.deepEqual(fake.children("fh").map((u) => fake.block(u).string), ["Old one", "Old two", "Fresh"]);
  assert.equal([...fake.block(res.uid).string.matchAll(ALIAS)][0][1], "3");
});

test("cap: notes beyond the write budget stay as plain (N) lines and a toast says so", async () => {
  const { fake, session } = setup();
  const toasts = [];
  session.on("toast", (t) => toasts.push(t.message));
  let md = "";
  const body = [];
  for (let i = 1; i <= 45; i += 1) {
    body.push(refToken(`n${i}`, String(i)));
    md += `\n${defLine(`n${i}`, String(i), `Note ${i}`)}`;
  }
  const res = await session.insertParsedCard({ x: 10, y: 10, markdown: `- Text ${body.join(" ")}${md}` });
  assert.equal(res.ok, true);
  const header = pageTop(fake).find((b) => b.string === "#footnotes");
  assert.equal(fake.children(header.uid).length, 40);
  assert.equal(res.writes <= 45, true);
  const card = fake.block(res.uid);
  assert.equal([...card.string.matchAll(ALIAS)].length, 40);
  assert.ok(card.string.includes(" (41)"));
  const lines = fake.children(res.uid).map((u) => fake.block(u).string);
  assert.ok(lines.includes("(41) Note 41"));
  assert.ok(lines.includes("(45) Note 45"));
  assert.equal(toasts.length, 1);
});

test("setting plain: tokens become (N) text and no page blocks are written", async () => {
  const { fake, session, created } = setup({ settings: { "parse-footnote-format": "plain" } });
  assert.equal(session.footnoteFormat(), "plain");
  const res = await session.insertParsedCard({ x: 10, y: 10, markdown: cardMd("n1", "1", "Alpha", "Note one") });
  assert.equal(fake.block(res.uid).string, "Alpha(1)");
  assert.equal(created.filter((c) => c.block.string === "#footnotes").length, 0);
  assert.deepEqual(fake.children(res.uid).map((u) => fake.block(u).string), ["(1) Note one"]);
});

test("format defaults to extension and normalizes junk", () => {
  assert.equal(setup().session.footnoteFormat(), "extension");
  assert.equal(setup({ settings: { "parse-footnote-format": "weird" } }).session.footnoteFormat(), "extension");
  assert.equal(setup({ settings: { "parse-footnote-format": "off" } }).session.footnoteFormat(), "off");
});

test("below the PDF: notes land on the PDF's page and the content follows the pdf block", async () => {
  const { fake, session } = setup();
  const md = ["- Heading text", cardMd("n1", "1", "Body", "Below note")].join("\n");
  const res = await session.insertParsedBelow({ pdfUid: "pdf1", markdown: md });
  assert.equal(res.ok, true);
  const top = pageTop(fake).map((b) => b.string);
  assert.equal(top[2], "Heading text");
  assert.ok(top.some((s) => /^Body#sup\^\^\[\(1\)\]/.test(s)));
  assert.equal(top.at(-1), "#footnotes");
});

test("send to board: sections share one header and one numbering run", async () => {
  const { fake, session } = setup();
  const res = await session.sendParsedToBoard({ x: 0, y: 0, sections: [
    { title: "A", markdown: cardMd("a1", "1", "One", "Note A") },
    { title: "B", markdown: cardMd("b1", "1", "Two", "Note B") },
  ] });
  assert.equal(res.ok, true);
  assert.equal(res.uids.length, 2);
  const header = pageTop(fake).find((b) => b.string === "#footnotes");
  assert.deepEqual(fake.children(header.uid).map((u) => fake.block(u).string), ["Note A", "Note B"]);
  assert.equal([...fake.block(res.uids[1]).string.matchAll(ALIAS)][0][1], "2");
  assert.ok(res.writes <= 45);
});

test("table insert, native: cell aliases link the notes; the note rows leave the table", async () => {
  const { fake, session } = setup();
  const res = await session.insertParsedTable({ x: 0, y: 0, table: notesTable(), mode: "native", notes: [{ id: "f9", mark: "1", text: "Notifiable." }] });
  assert.equal(res.ok, true);
  assert.equal(res.path, "native");
  const header = pageTop(fake).find((b) => b.string === "#footnotes");
  const notes = fake.children(header.uid).map((u) => fake.block(u));
  assert.deepEqual(notes.map((n) => n.string), ["Congenital rubella cases only.", "Provisional.", "Notifiable."]);
  const cellStrings = [];
  const walk = (uid) => { const b = fake.block(uid); cellStrings.push(b.string); b.children.forEach(walk); };
  walk(res.uid);
  const joined = cellStrings.join("\n");
  const found = [...joined.matchAll(ALIAS)].map((m) => [m[1], m[2]]);
  assert.deepEqual(found, [["1", notes[0].uid], ["2", notes[1].uid], ["3", notes[2].uid]]);
  assert.ok(!joined.includes("Congenital rubella cases only."));
  assert.ok(!joined.includes(FN_OPEN));
});

test("table insert, grid: the model rows carry the aliases", async () => {
  const { fake, session } = setup();
  let seen = null;
  const host = session.host;
  host.canCreateGridTable = () => true;
  host.createGridTable = async (spec) => {
    seen = spec;
    const uid = host.generateUid();
    await host.createBlock({ parentUid: spec.parentUid, order: spec.order, uid, string: "{{[[table]]}}" });
    return { uid, writes: 1, path: "markdown" };
  };
  const res = await session.insertParsedTable({ x: 0, y: 0, table: notesTable(), mode: "grid", notes: [] });
  assert.equal(res.path, "grid");
  assert.equal(seen.rows.length, 4);
  assert.match(seen.rows[1][0], /^Rubella congenital syndrome#sup\^\^\[\(1\)\]\(\(\([^)]+\)\)\)\^\^$/);
  assert.match(seen.rows[1][1], /^1,000#sup\^\^\[\(2\)\]/);
  assert.deepEqual(seen.alignments, [{ col: 1, align: "right" }]);
  assert.ok(pageTop(fake).some((b) => b.string === "#footnotes"));
});

test("table insert, plain setting: (N) cells and merged note rows, no page blocks", async () => {
  const { fake, session } = setup({ settings: { "parse-footnote-format": "plain" } });
  const res = await session.insertParsedTable({ x: 0, y: 0, table: notesTable(), mode: "native", notes: [] });
  assert.equal(res.ok, true);
  assert.equal(pageTop(fake).some((b) => b.string === "#footnotes"), false);
  const strings = [];
  const walk = (uid) => { const b = fake.block(uid); strings.push(b.string); b.children.forEach(walk); };
  walk(res.uid);
  assert.ok(strings.includes("Rubella congenital syndrome(1)"));
  assert.ok(strings.includes("(1) Congenital rubella cases only."));
});

test("table insert, off: the table is written untouched", async () => {
  const { fake, session } = setup({ settings: { "parse-footnote-format": "off" } });
  const res = await session.insertParsedTable({ x: 0, y: 0, table: notesTable(), mode: "native", notes: [] });
  const strings = [];
  const walk = (uid) => { const b = fake.block(uid); strings.push(b.string); b.children.forEach(walk); };
  walk(res.uid);
  assert.ok(strings.includes("Rubella congenital syndrome**"));
  assert.equal(pageTop(fake).some((b) => b.string === "#footnotes"), false);
});

test("an insert without footnotes writes nothing extra", async () => {
  const { fake, session, created } = setup();
  const res = await session.insertParsedCard({ x: 10, y: 10, markdown: "- Just text" });
  assert.equal(res.writes, 2);
  assert.equal(created.filter((c) => c.block.string === "#footnotes").length, 0);
  assert.equal(fake.block(res.uid).string, "Just text");
});

// ---- the view hook -------------------------------------------------------------------------

test("parse actions pass the session's format and the page's notes", async () => {
  const doc = {
    sha256: "s", engine: "builtin", optsHash: "o",
    order: ["p1", "f1", "t1"],
    blocks: {
      p1: para("p1", "Cases rose¹.", [{ mark: "1", at: 11, to: "f1" }]),
      f1: note("f1", "1", "Counts."),
      t1: { id: "t1", type: "table", page: 1, rows: 1, cols: 1, headerRows: 0, cells: [{ r: 0, c: 0, text: "x¹" }] },
    },
  };
  const calls = [];
  const session = {
    footnoteFormat: () => "extension",
    async insertParsedCard(arg) { calls.push(["card", arg]); return { ok: true, uid: "u" }; },
    async insertParsedTable(arg) { calls.push(["table", arg]); return { ok: true, uid: "u", path: "native" }; },
  };
  const store = { getParse: async () => doc };
  const actions = createParseActions({ session, store });
  await actions.insertParsedCard({ ids: ["p1", "f1"] });
  assert.ok(calls[0][1].markdown.includes(FN_OPEN));
  await actions.insertParsedTable({ ids: ["t1"] });
  assert.deepEqual(calls[1][1].notes, [{ id: "f1", mark: "1", text: "Counts." }]);
  await handleParseDrop({ payload: { sha256: "s", engine: "builtin", optsHash: "o", kind: "blocks", ids: ["p1", "f1"] }, store, session, point: { x: 1, y: 2 } });
  assert.ok(calls[2][1].markdown.includes(FN_OPEN));
  const legacy = createParseActions({ session: { async insertParsedCard(arg) { calls.push(["legacy", arg]); return { ok: true, uid: "u" }; } }, store });
  await legacy.insertParsedCard({ ids: ["p1", "f1"] });
  assert.equal(calls[3][1].markdown, "- Cases rose[1].\n- [1] Counts.");
  assert.equal(plainFootnotes(["x"]).notes.length, 0);
});
