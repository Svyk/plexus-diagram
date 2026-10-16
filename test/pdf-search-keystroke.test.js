// PDF-only search must not scan the graph on every key. The first search may read the PDF list.
// Later keys, at the panel debounce, call q() and pull() zero times.
import assert from "node:assert/strict";
import test from "node:test";

import { createHost } from "../src/host/roam.js";
import { createPartsIndex } from "../src/host/parts-index.js";
import { buildPartsIndex, searchParts } from "../src/model/parts-search.js";
import { createPanel } from "../src/view/panel.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";

const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const DEBOUNCE_MS = 150;
const timers = {
  later: (fn, ms) => {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  },
  frame: () => () => {},
};

const PDFS = [
  ["{{[[pdf]]: https://x.test/drains-seasonal-peak.pdf}}", "pdf1", "MAIN"],
  ["{{[[pdf]]: https://x.test/other.pdf}}", "pdf2", "Notes"],
];

function countingHost() {
  const fake = createFakeRoam();
  const reads = { q: 0, pull: 0 };
  const q = fake.api.data.q.bind(fake.api.data);
  const pull = fake.api.data.pull.bind(fake.api.data);
  const countQ = (...args) => { reads.q += 1; return q(...args); };
  fake.api.data.q = countQ;
  fake.api.data.fast.q = countQ;
  fake.api.data.pull = (...args) => { reads.pull += 1; return pull(...args); };
  // The pdf pattern is a query input, not part of the query text.
  // listPdfBlocks asks for uid, string, page title. A tag or days query asks for the string first.
  fake.onQuery(/:find/, (query, ...inputs) => {
    const q = String(query);
    if (!`${q} ${inputs.map(String).join(" ")}`.includes("pdf")) return [];
    if (q.includes(":find ?u ?s ?t")) return PDFS.map(([string, uid, pageTitle]) => [uid, string, pageTitle]);
    return PDFS;
  });
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "Readwisenotes" });
  let pdfBlockList = null;
  let board = "MAIN";
  const pdfBlocks = () => {
    if (pdfBlockList && pdfBlockList.board === board) return pdfBlockList.rows;
    const rows = host.listPdfBlocks(1000) || [];
    pdfBlockList = { board, rows };
    return rows;
  };
  return {
    fake,
    host,
    reads,
    pdfBlocks,
    setBoard: (next) => { board = next; },
    dropCache: () => { pdfBlockList = null; },
  };
}

function mount(env, parts) {
  const stub = createDomStub();
  const restore = stub.install();
  const root = stub.document.createElement("div");
  root.className = "pxd-root";
  stub.document.body.append(root);
  const searches = [];
  const raw = env.host.librarySearch.bind(env.host);
  env.host.librarySearch = (filter, limit, opts) => {
    searches.push(filter.text);
    return raw(filter, limit, opts);
  };
  const panel = createPanel({
    doc: stub.document,
    root,
    host: env.host,
    timers,
    on: {
      loadTypes: () => ["pdf"],
      pdfList: () => env.pdfBlocks(),
      searchParts: async (query, limit) => searchParts(await parts.get(), query, limit),
      searchPdfText: () => [],
    },
  });
  panel.open("search");
  return { stub, restore, root, panel, searches };
}

test("typing with the PDF filter calls q() and pull() only on the first search", async (t) => {
  const env = countingHost();
  const parts = createPartsIndex({
    store: { findByUrl: async () => null },
    listPdfs: () => env.pdfBlocks(),
  });
  const f = mount(env, parts);
  t.after(() => { parts.dispose(); f.restore(); });
  const input = f.root.querySelector(".pxd-panel__input");
  const type = async (text) => {
    input.value = text;
    f.stub.dispatch(input, "input");
    await tick(DEBOUNCE_MS + 40);
  };

  input.value = "d";
  f.stub.dispatch(input, "input");
  input.value = "dr";
  f.stub.dispatch(input, "input");
  input.value = "dra";
  f.stub.dispatch(input, "input");
  await tick(DEBOUNCE_MS / 2);
  assert.equal(f.searches.length, 0, "keys inside the debounce do not search");
  await tick(DEBOUNCE_MS);
  assert.deepEqual(f.searches, ["dra"]);
  assert.ok(env.reads.q >= 1, "the first search may read the PDF list");
  const qAfterFirst = env.reads.q;
  const pullAfterFirst = env.reads.pull;

  for (const text of ["drai", "drain", "drains", "drains seasonal", "drains seasonal peak"]) {
    await type(text);
    assert.equal(env.reads.q, qAfterFirst, `q() ran again while typing "${text}"`);
    assert.equal(env.reads.pull, pullAfterFirst, `pull() ran again while typing "${text}"`);
  }
  assert.ok(f.root.querySelector(".pxd-panel__row"), "a PDF whose string holds the phrase is still a hit");
});

test("part search looks up an index after the rows are indexed", () => {
  const blocks = {};
  const order = [];
  for (let page = 1; page <= 80; page += 1) {
    for (let i = 0; i < 20; i += 1) {
      const id = `b${page}-${i}`;
      blocks[id] = {
        id,
        type: "para",
        page,
        text: `Page ${page} paragraph ${i} lorem ipsum dolor sit amet consectetur adipiscing elit`,
      };
      order.push(id);
    }
  }
  blocks["b40-3"].text += " drains seasonal peak flow";
  const rows = buildPartsIndex({ sha256: "big", blocks, order }, { docTitle: "Report" });
  assert.ok(rows.length > 1000);
  let reads = 0;
  for (const row of rows) {
    const lower = row.lower;
    Object.defineProperty(row, "lower", { get() { reads += 1; return lower; } });
  }
  searchParts(rows, { text: "lorem" });
  reads = 0;
  const hit = searchParts(rows, { text: "drains seasonal peak", kinds: ["paragraph"], pages: "p. 30-50" });
  assert.equal(hit.length, 1);
  assert.equal(hit[0].page, 40);
  assert.equal(reads, 0, "a later key still read part text");
});
