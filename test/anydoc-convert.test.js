import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createAnydocHost } from "../src/host/anydoc.js";
import { ANYDOC_MANIFEST } from "../src/host/anydoc-manifest.js";
import { markdownToParse, planFromParse, ROW_TOAST } from "../src/model/anydoc-to-parse.js";
import { planParseInsert } from "../src/model/drop.js";
import { validateParse } from "../src/model/parse-schema.js";

const fixture = (name) => readFile(new URL(`./fixtures/office/${name}`, import.meta.url));
const asset = (name) => readFile(new URL(`../assets/anydoc/${name}`, import.meta.url));

const files = new Map();
async function localFetch(url) {
  const name = String(url).split("/").pop();
  if (!files.has(name)) files.set(name, await asset(name));
  return new Response(files.get(name));
}

const host = createAnydocHost({ fetch: localFetch, caches: null });
const times = {};

async function converted(name, format) {
  const out = await host.convert(await fixture(name), format);
  times[name] = Math.round(out.ms * 10) / 10;
  const doc = markdownToParse(out.markdown, { format, title: name });
  assert.equal(validateParse(doc).ok, true, validateParse(doc).errors.join(","));
  return { ...out, doc, plan: planFromParse(doc, { format, planSections: planParseInsert }) };
}

test("fixture office files convert through the hashed wasm", async () => {
  const before = host.fetchCount;
  const notes = await converted("notes.docx", "docx");
  assert.match(notes.markdown, /Weekly notes/);
  assert.match(notes.markdown, /Milk powder holds/);
  assert.match(notes.markdown, /Percent/);
  assert.equal(notes.plan.action, "sections");

  const deck = await converted("deck.pptx", "pptx");
  assert.match(deck.markdown, /Deck Title/);
  assert.match(deck.markdown, /Speaker note/);
  assert.equal(deck.plan.action, "slides");
  assert.match(deck.plan.sections[0].markdown, /^- Deck Title/);

  const sheet = await converted("sheet.xlsx", "xlsx");
  assert.match(sheet.markdown, /Values/);
  assert.equal(sheet.plan.toast, ROW_TOAST);
  const long = sheet.plan.tables.find((row) => row.name === "Long");
  assert.equal(long.table.rows, 300);

  const csv = await converted("sheet.csv", "csv");
  assert.equal(csv.plan.tables.length, 1);
  assert.equal(csv.plan.tables[0].name, "Sheet");
  assert.match(csv.markdown, /Count/);

  const book = await converted("book.epub", "epub");
  assert.match(book.markdown, /Chapter One/);
  assert.match(book.markdown, /Fixture Book/);
  assert.equal(book.plan.action, "chapters");
  assert.equal(book.plan.sections.length, 3);

  const odt = await converted("note.odt", "odt");
  assert.match(odt.markdown, /Weekly notes/);
  assert.equal(odt.plan.action, "card");

  assert.equal(host.fetchCount, before + 2);
  assert.equal(times["notes.docx"] >= 0, true);
  console.log(`anydoc fixture ms ${JSON.stringify(times)}`);
  assert.equal(ANYDOC_MANIFEST.version, "0.2.4");
});
