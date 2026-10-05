import test from "node:test";
import assert from "node:assert/strict";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";

const URL = "https://example.test/papers/Risk%20model.pdf";
const MACRO = `{{[[pdf]]: ${URL}}}`;

function setup() {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  return { fake, host };
}

function stubCover(fake, { page = [["pageUid01", "Risk model.pdf"]], blocks = [] } = {}) {
  const calls = [];
  fake.setQ((query, ...inputs) => {
    calls.push([query, ...inputs]);
    if (String(query).includes(":pdf/url")) return page;
    if (String(query).includes(":block/page")) return blocks;
    return [["unexpected"]];
  });
  return calls;
}

test("one :pdf-highlight row counts 1 and a Notes by parent with no highlight prop counts 0", () => {
  const { fake, host } = setup();
  const calls = stubCover(fake, {
    blocks: [
      [{}],
      [{ ":created": 1 }],
      [{ ":pdf-highlight": { ":type": "text", ":id": "hl01" } }],
    ],
  });
  fake.clearLog();
  const cover = host.pdfCover(MACRO);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0].includes(":pdf/url"), true);
  assert.equal(calls[0][0].includes(":block/props"), false);
  assert.equal(/re-find|re-pattern/.test(calls[0][0]), false);
  assert.deepEqual(calls[0].slice(1), [URL]);
  assert.equal(calls[1][0].includes(":block/page"), true);
  assert.equal(calls[1][0].includes(":block/children"), false);
  assert.equal(calls[1][0].includes(":pdf-highlight"), false);
  assert.deepEqual(calls[1].slice(1), ["pageUid01"]);
  assert.deepEqual(cover, {
    title: "Risk model.pdf",
    count: 1,
    label: "1 highlight",
    pageUid: "pageUid01",
  });
  assert.equal(host.stats.writes, 0);
  assert.equal(fake.writesLog().length, 0);
});

test("a Notes by parent with no highlight prop counts 0", () => {
  const { fake, host } = setup();
  stubCover(fake, {
    blocks: [[{ ":heading": 2 }]],
  });
  fake.clearLog();
  const cover = host.pdfCover(` \n${MACRO} `);
  assert.deepEqual(cover, {
    title: "Risk model.pdf",
    count: 0,
    label: "0 highlights",
    pageUid: "pageUid01",
  });
  assert.equal(host.stats.writes, 0);
  assert.equal(fake.writesLog().length, 0);
});

test("an empty macro returns count 0 and does not query", () => {
  const { fake, host } = setup();
  let queries = 0;
  fake.setQ(() => {
    queries++;
    return [["pageUid01", "Risk model.pdf"]];
  });
  fake.clearLog();
  for (const string of ["", "   ", "{{[[pdf]]:}}", "see {{[[pdf]]: https://example.test/a.pdf}}", null, undefined]) {
    const cover = host.pdfCover(string);
    assert.equal(cover.count, 0);
    assert.equal(cover.pageUid, null);
    assert.equal(cover.label, "0 highlights");
    assert.equal(cover.title, "PDF");
  }
  assert.equal(queries, 0);
  assert.equal(host.stats.writes, 0);
  assert.equal(fake.writesLog().length, 0);
});

test("no pdf page returns count 0 and a null pageUid", () => {
  const { fake, host } = setup();
  const calls = stubCover(fake, { page: [] });
  fake.clearLog();
  const cover = host.pdfCover(MACRO);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(1), [URL]);
  assert.deepEqual(cover, {
    title: "Risk model",
    count: 0,
    label: "0 highlights",
    pageUid: null,
  });
  assert.equal(host.stats.writes, 0);
  assert.equal(fake.writesLog().length, 0);
});

test("two :pdf-highlight rows count 2 and pdfCover still does not write", () => {
  const { fake, host } = setup();
  stubCover(fake, {
    blocks: [
      [{}],
      [{ ":pdf-highlight": { ":type": "text" } }],
      [{ "pdf-highlight": { ":type": "area" } }],
    ],
  });
  fake.clearLog();
  const cover = host.pdfCover(MACRO);
  assert.equal(cover.count, 2);
  assert.equal(cover.label, "2 highlights");
  assert.equal(cover.pageUid, "pageUid01");
  assert.equal(host.stats.writes, 0);
  assert.equal(fake.writesLog().length, 0);
});
