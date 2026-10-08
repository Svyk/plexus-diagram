import assert from "node:assert/strict";
import test from "node:test";

import {
  NEXT_OFFER,
  OFFICE_BATCH,
  ROW_CAP,
  ROW_TOAST,
  markdownToParse,
  officeFetchAllowed,
  officeTargetFromText,
  planFromParse,
} from "../src/model/anydoc-to-parse.js";
import { handleOfficeDrop, parseDropPayload, planParseInsert } from "../src/model/drop.js";
import { validateParse } from "../src/model/parse-schema.js";
import { buildMenu } from "../src/view/menu-model.js";
import { createParseView } from "../src/view/parse-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const NOTES = `# Weekly notes

Milk powder holds.

- Alpha

- Beta

## Checks

Second section.

| Kind | Value |
| --- | --- |
| Percent | 15 |
`;

const DECK = `## Deck Title

Point one

> Speaker note

## Numbers

- North is 42

> Table note
`;

const CSV = `| Kind | Value |
| --- | --- |
| Percent | 15 |
| Count | 3 |
`;

function longSheet() {
  const lines = ["## Values", "", "| Kind | Value |", "| --- | --- |", "| Percent | 15 |", "", "## Long", "", "| N |", "| --- |"];
  for (let i = 1; i <= 301; i += 1) lines.push(`| ${i} |`);
  return lines.join("\n");
}

function plan(markdown, format, offset = 0) {
  const doc = markdownToParse(markdown, { format, engine: "anydoc" });
  return { doc, plan: planFromParse(doc, { format, offset, planSections: planParseInsert }) };
}

test("markdown becomes pxd-parse/1 with headings, paragraphs, lists, and tables", () => {
  const doc = markdownToParse(NOTES, { format: "docx", title: "notes.docx", sha256: "abc" });
  assert.equal(validateParse(doc).ok, true);
  assert.equal(doc.engine, "anydoc");
  assert.equal(doc.engineVersion, "anydoc-wasm/0.2.4");
  const blocks = doc.order.map((id) => doc.blocks[id]);
  assert.equal(blocks[0].type, "heading");
  assert.equal(blocks[0].text, "Weekly notes");
  assert.equal(blocks[1].type, "para");
  assert.equal(blocks[1].text, "Milk powder holds.");
  const list = blocks.find((block) => block.type === "list");
  assert.equal(list.ordered, false);
  assert.deepEqual(list.items.map((item) => item.text), ["Alpha", "Beta"]);
  const table = blocks.find((block) => block.type === "table");
  assert.equal(table.rows, 2);
  assert.equal(table.cols, 2);
  assert.equal(table.headerRows, 1);
  assert.equal(table.cells.find((cell) => cell.r === 1 && cell.c === 0).text, "Percent");
  assert.equal(table.cells.find((cell) => cell.r === 1 && cell.c === 1).text, "15");
});

test("docx and odt go through section cards; one heading stays one card", () => {
  const docx = plan(NOTES, "docx").plan;
  assert.equal(docx.action, "sections");
  assert.equal(docx.sections.length, 2);
  assert.match(docx.sections[0].markdown, /^- # Weekly notes/);
  assert.match(docx.sections[0].markdown, /Alpha/);
  assert.match(docx.sections[1].markdown, /Checks/);
  assert.match(docx.sections[1].markdown, /Percent/);
  const odt = plan("# Weekly notes\n\nMilk powder holds.\n", "odt").plan;
  assert.equal(odt.action, "card");
  assert.match(odt.markdown, /^- # Weekly notes/);
});

test("pptx is one card per slide with a plain title and notes as children", () => {
  const slides = plan(DECK, "pptx").plan;
  assert.equal(slides.action, "slides");
  assert.equal(slides.sections.length, 2);
  assert.match(slides.sections[0].markdown, /^- Deck Title\n- Point one\n- Speaker note/);
  assert.equal(slides.sections[0].markdown.startsWith("- #"), false);
  assert.match(slides.sections[1].markdown, /^- Numbers/);
  assert.match(slides.sections[1].markdown, /North is 42/);
  assert.match(slides.sections[1].markdown, /Table note/);
});

test("xlsx caps a sheet at 300 rows and csv is one table", () => {
  const sheet = plan(longSheet(), "xlsx").plan;
  assert.equal(sheet.action, "grids");
  assert.equal(sheet.toast, ROW_TOAST);
  assert.equal(sheet.toast, "first 300 rows");
  const long = sheet.tables.find((row) => row.name === "Long");
  assert.equal(long.table.rows, ROW_CAP);
  assert.equal(long.truncated, true);
  assert.equal(long.table.cells.find((cell) => cell.r === 299 && cell.c === 0).text, "299");
  assert.equal(long.table.cells.some((cell) => cell.text === "301"), false);
  const values = sheet.tables.find((row) => row.name === "Values");
  assert.equal(values.truncated, false);
  const csv = plan(CSV, "csv").plan;
  assert.equal(csv.action, "grids");
  assert.equal(csv.tables.length, 1);
  assert.equal(csv.tables[0].name, "Sheet");
  assert.equal(csv.toast, undefined);
  assert.equal(csv.tables[0].table.rows, 3);
});

test("epub chapters batch at 22 cards and offer next 45", () => {
  const markdown = Array.from({ length: 30 }, (_, i) => `# Chapter ${i}\n\nBody ${i}`).join("\n\n");
  const first = plan(markdown, "epub").plan;
  assert.equal(first.action, "chapters");
  assert.equal(first.sections.length, OFFICE_BATCH);
  assert.equal(OFFICE_BATCH, 22);
  assert.equal(first.more, true);
  assert.equal(first.offer, NEXT_OFFER);
  assert.equal(first.offer, "next 45");
  assert.match(first.sections[0].markdown, /^- Chapter 0/);
  assert.equal(first.sections[0].markdown.startsWith("- #"), false);
  const rest = plan(markdown, "epub", first.nextOffset).plan;
  assert.equal(rest.sections.length, 8);
  assert.equal(rest.more, false);
  assert.match(rest.sections[0].markdown, /Chapter 22/);
});

test("a file link is the whole string, and encrypted or non-https urls are refused", () => {
  const hit = officeTargetFromText("[notes.docx](https://files.example/notes.docx)");
  assert.equal(hit.format, "docx");
  assert.equal(hit.url, "https://files.example/notes.docx");
  assert.equal(officeTargetFromText("see [notes.docx](https://files.example/notes.docx) in the notes"), null);
  assert.equal(officeTargetFromText("https://files.example/sheet.xlsx").format, "xlsx");
  assert.equal(officeTargetFromText("https://files.example/report.pdf"), null);
  assert.equal(officeTargetFromText("https://files.example/notes.docx.enc"), null);
  assert.equal(officeFetchAllowed("https://files.example/notes.docx.enc"), false);
  assert.equal(officeFetchAllowed("http://files.example/notes.docx"), false);
  assert.equal(officeFetchAllowed("blob:https://roamresearch.com/notes.docx"), false);
  assert.equal(officeFetchAllowed("https://files.example/book.epub"), true);
});

test("a dropped office file or whole-string link is an office payload; a pdf or image is not", () => {
  const dt = (data, extra = {}) => ({
    getData(type) { return data[type] ?? ""; },
    types: Object.keys(data),
    ...extra,
  });
  const file = dt({ "text/plain": "" }, { files: [{ name: "notes.docx" }] });
  assert.equal(parseDropPayload(file)[0].office.format, "docx");
  const link = dt({ "text/plain": "https://files.example/deck.pptx" });
  assert.equal(parseDropPayload(link)[0].office.format, "pptx");
  assert.equal(parseDropPayload(dt({ "text/plain": "https://files.example/report.pdf" })).length, 0);
  assert.equal(parseDropPayload(dt({ "text/plain": "https://files.example/notes.docx.enc" })).length, 0);
  assert.equal(parseDropPayload(dt({ "text/plain": "" }, { files: [{ name: "a.png", type: "image/png" }] })).length, 0);
  assert.deepEqual(parseDropPayload(dt({ "text/plain": "see [[x]] now" })), [{ string: "[[x]]" }]);
});

test("convert to cards is on a file-link card only", () => {
  const menu = buildMenu("card", { officeFile: { url: "https://files.example/notes.docx", format: "docx", name: "notes.docx" } });
  assert.equal(menu.find((item) => item.id === "convert-office").label, "Convert to cards");
  assert.equal(buildMenu("card", {}).some((item) => item.id === "convert-office"), false);
});

test("office insert offers the next batch without converting again", async () => {
  const markdown = Array.from({ length: 30 }, (_, i) => `# Chapter ${i}\n\nBody ${i}`).join("\n\n");
  let converts = 0;
  const sizes = [];
  const session = {
    async sendParsedToBoard({ sections }) {
      sizes.push(sections.length);
      return { ok: true, uids: sections.map((_, index) => `u${sizes.length}-${index}`) };
    },
  };
  const first = await handleOfficeDrop({
    office: { format: "epub", name: "book.epub", file: { arrayBuffer: async () => new Uint8Array([1, 2]) } },
    convert: async () => { converts += 1; return { markdown, ms: 4, format: "epub" }; },
    session,
    point: { x: 8, y: 16 },
  });
  assert.equal(converts, 1);
  assert.equal(sizes[0], 22);
  assert.equal(first.offer, "next 45");
  const second = await first.continue();
  assert.equal(converts, 1);
  assert.equal(sizes[1], 8);
  assert.equal(second.more, false);
  assert.equal(second.uids.length, 8);
});

test("encrypted bytes and a refused url toast instead of writing", async () => {
  const session = { async sendParsedToBoard() { throw new Error("wrote"); } };
  const encrypted = await handleOfficeDrop({
    office: { format: "docx", name: "secret.docx", file: { arrayBuffer: async () => new Uint8Array([1]) } },
    convert: async () => { const err = new Error("locked"); err.code = "encrypted"; throw err; },
    session,
    point: { x: 0, y: 0 },
  });
  assert.equal(encrypted.toast, "Encrypted files stay in Roam's reader");
  const refused = await handleOfficeDrop({
    office: { format: "docx", name: "secret.docx", url: "https://files.example/secret.docx.enc" },
    convert: async () => { throw new Error("should not convert"); },
    session,
    point: { x: 0, y: 0 },
  });
  assert.equal(refused.toast, "Could not fetch this file");
});

test("alternative read replaces the outline only when conversion works", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const toasts = [];
    const blocked = createParseView({
      doc: stub.document,
      anydoc: { async convert() { const err = new Error("ocr"); err.code = "needsOcr"; throw err; } },
      getPdf: async () => ({ getData: async () => new Uint8Array([4, 5, 6]) }),
      onToast: (message) => toasts.push(message),
      clock: () => 20,
    });
    blocked.element().querySelector(".pxd-parse__alt").click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.match(toasts.at(-1), /built-in parse stays/);
    assert.equal(blocked.chipText().includes("Alternative read"), false);

    const done = [];
    const ok = createParseView({
      doc: stub.document,
      anydoc: { async convert() { return { markdown: "# Hi\n\nThere.", ms: 12, format: "pdf" }; } },
      getPdf: async () => ({ getData: async () => new Uint8Array([7, 8]) }),
      onToast: (message) => done.push(message),
      clock: () => 40,
    });
    ok.element().querySelector(".pxd-parse__alt").click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(done.length, 0);
    assert.match(ok.chipText(), /^Alternative read/);
    assert.match(ok.element().textContent, /There/);
  } finally {
    restore();
  }
});
