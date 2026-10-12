// Keeping a finished read in the graph: upload + one prop write, restore on a second device, no writes otherwise.
import assert from "node:assert/strict";
import test from "node:test";

import { createParseStore } from "../src/host/parse-store.js";
import {
  READS_KEY, READ_SCHEMA, createReadKeeper, isCompleteRead, mergeReads, readKind,
} from "../src/host/read-keep.js";
import { sha256Hex } from "../src/model/parse-hash.js";
import { PARSE_REV } from "../src/model/parse/index.js";
import { createParseView } from "../src/view/parse-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const PDF = new TextEncoder().encode("%PDF-1.7 fake bytes for the keep-reads test");

function parseDoc(sha, over = {}) {
  return {
    schema: "pxd-parse/1",
    engine: "builtin",
    sha256: sha,
    optsHash: "h1",
    parseRev: PARSE_REV,
    pageCount: 2,
    pages: [{ n: 1, w: 100, h: 200, rotation: 0, kind: "text" }, { n: 2, w: 100, h: 200, rotation: 0, kind: "text" }],
    order: ["p1", "p2"],
    blocks: {
      p1: { id: "p1", type: "para", page: 1, text: "Alpha", bbox: [0, 0, 10, 10], confidence: 0.9 },
      p2: { id: "p2", type: "para", page: 2, text: "Beta", bbox: [0, 0, 10, 10], confidence: 0.9 },
    },
    removed: [],
    stats: { ms: 10 },
    options: { ocr: "vision" },
    ...over,
  };
}

const builtinPlain = (sha) => parseDoc(sha, { options: { ocr: "none" } });
const helperRead = (sha) => parseDoc(sha, { ocr: { source: "helper" }, pages: parseDoc(sha).pages.map((p) => ({ ...p, ocr: true })) });
const highRead = (sha) => ({ ...helperRead(sha), ocr: { source: "helper", mode: "high" } });
const doclingRead = (sha) => parseDoc(sha, { engine: "docling", options: { ocr: "auto" } });
const cloudRead = (sha) => parseDoc(sha, { engine: "cloud", options: { provider: "llamaparse", tier: "agentic", region: "us", ocr: "none" } });
const browserRead = (sha) => ({ ...helperRead(sha), ocr: { source: "browser" } });

// A shared graph: files by url, block props by uid. Each device has its own host view, store and writes count.
function makeGraph() {
  const files = new Map();
  const props = new Map([["blk", { ":rf-diagram": true, plexus: { v: 2 }, other: { keep: "me" } }]]);
  return { files, props, nextFile: 0 };
}

function makeDevice(graph, { encrypted = true, setting = true, failGet = false } = {}) {
  const log = { uploads: [], writes: 0, gets: [], warns: [] };
  const host = {
    stats: { writes: 0 },
    pullProps: (uid) => JSON.parse(JSON.stringify(graph.props.get(uid) || {})),
    async uploadFile(file) {
      log.uploads.push(file);
      log.writes += 1;
      const url = `https://firebasestorage.example/f${graph.nextFile += 1}`;
      graph.files.set(url, new Uint8Array(await file.arrayBuffer()));
      // Roam answers non-image uploads with a markdown link.
      return `[${file.name}](${url})`;
    },
    async updateReads(uid, reads) {
      log.writes += 1;
      graph.props.set(uid, { ...(graph.props.get(uid) || {}), [READS_KEY]: JSON.parse(JSON.stringify(reads)) });
    },
    async getFile(url) {
      log.gets.push(url);
      if (!encrypted || failGet) return failGet ? null : null;
      const bytes = graph.files.get(url);
      return bytes ? new Blob([bytes]) : null;
    },
  };
  const store = createParseStore({});
  const keeper = createReadKeeper({
    host, store, now: () => 1000, log: (m) => log.warns.push(m),
    settings: { get: (id) => (id === "keep-reads" ? setting : undefined) },
  });
  return { host, store, keeper, log };
}

test("readKind keeps helper, High accuracy, docling and cloud reads; never the built-in parse or a browser read", () => {
  assert.equal(readKind(builtinPlain("a")), null);
  assert.equal(readKind(browserRead("a")), null);
  assert.deepEqual(readKind(helperRead("a")), { engine: "builtin", mode: "helper", rank: 1 });
  assert.deepEqual(readKind(highRead("a")), { engine: "builtin", mode: "high", rank: 3 });
  assert.deepEqual(readKind(doclingRead("a")), { engine: "docling", mode: "helper", rank: 1 });
  assert.deepEqual(readKind(cloudRead("a")), { engine: "cloud", mode: "llamaparse", rank: 2 });
});

test("a helper, High accuracy and cloud read each upload once and note the block: two writes", async () => {
  for (const make of [helperRead, highRead, cloudRead, doclingRead]) {
    const graph = makeGraph();
    const a = makeDevice(graph);
    const doc = make("sha-a");
    const res = await a.keeper.keepRead(doc, { blockUid: "blk", total: 2 });
    assert.equal(res.ok, true, make.name);
    assert.equal(a.log.uploads.length, 1);
    assert.equal(a.log.writes, 2, "upload + prop update");
    assert.match(a.log.uploads[0].name, /^plexus-read-sha-a-(builtin|cloud|docling)\.json\.gz$/);
    const kind = readKind(doc);
    const entry = graph.props.get("blk")[READS_KEY][`${kind.engine}:${kind.mode}`];
    assert.equal(entry.sha256, "sha-a");
    assert.equal(entry.engine, kind.engine);
    assert.equal(entry.mode, kind.mode);
    assert.equal(entry.schema, READ_SCHEMA);
    assert.equal(entry.parseRev, PARSE_REV);
    assert.equal(entry.createdAt, 1000);
    assert.equal(entry.bytes, a.log.uploads[0].size);
    assert.match(entry.url, /^https:\/\/firebasestorage\.example\/f1$/);
  }
});

test("a built-in parse, a browser read, and a partial read upload nothing", async () => {
  const graph = makeGraph();
  const a = makeDevice(graph);
  assert.equal((await a.keeper.keepRead(builtinPlain("s"), { blockUid: "blk" })).reason, "not-kept");
  assert.equal((await a.keeper.keepRead(browserRead("s"), { blockUid: "blk" })).reason, "not-kept");
  const partial = { ...cloudRead("s"), pages: [{ n: 3, w: 1, h: 1, rotation: 0, kind: "text" }], pageCount: 1 };
  assert.equal(isCompleteRead(partial, 0), false);
  assert.equal((await a.keeper.keepRead(partial, { blockUid: "blk" })).reason, "partial");
  assert.equal((await a.keeper.keepRead(cloudRead("s"), { blockUid: "blk", total: 300 })).reason, "partial");
  assert.equal((await a.keeper.keepRead(cloudRead("s"), { blockUid: "" })).reason, "no-target");
  assert.equal(a.log.writes, 0);
  assert.equal(graph.props.get("blk")[READS_KEY], undefined);
});

test("with the setting off nothing is uploaded or noted, and a kept read still restores", async () => {
  const graph = makeGraph();
  const on = makeDevice(graph);
  const sha = await sha256Hex(PDF);
  await on.keeper.keepRead(highRead(sha), { blockUid: "blk", total: 2 });
  const off = makeDevice(graph, { setting: false });
  assert.equal((await off.keeper.keepRead(cloudRead(sha), { blockUid: "blk" })).reason, "off");
  assert.equal(off.log.writes, 0);
  assert.equal(Object.keys(graph.props.get("blk")[READS_KEY]).length, 1);
  const got = await off.keeper.restoreRead({ blockUid: "blk", getBytes: async () => PDF });
  assert.equal(got.sha256, sha);
  assert.equal(off.log.writes, 0);
});

test("device B restores the best kept read from the block props into an empty store (file.get path)", async () => {
  const graph = makeGraph();
  const a = makeDevice(graph);
  const sha = await sha256Hex(PDF);
  await a.keeper.keepRead(helperRead(sha), { blockUid: "blk", total: 2 });
  await a.keeper.keepRead(cloudRead(sha), { blockUid: "blk", total: 2 });
  await a.keeper.keepRead(highRead(sha), { blockUid: "blk", total: 2 });
  assert.equal(Object.keys(graph.props.get("blk")[READS_KEY]).length, 3);

  const b = makeDevice(graph);
  assert.deepEqual(await b.store.listParses(sha), []);
  const got = await b.keeper.restoreRead({ blockUid: "blk", url: "https://x/y.pdf", getBytes: async () => PDF });
  assert.equal(got.ocr.mode, "high", "High accuracy wins over cloud and helper");
  assert.equal(b.log.gets.length, 1, "fetched through file.get");
  assert.equal(b.log.writes, 0, "restore writes nothing");
  const listed = await b.store.listParses(sha);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].doc.blocks.p1.text, "Alpha");
  assert.equal((await b.store.findByUrl("https://x/y.pdf")).sha256, sha);
});

test("device B falls back to the next entry when the best one cannot be fetched, and to nothing on failure", async () => {
  const graph = makeGraph();
  const a = makeDevice(graph);
  const sha = await sha256Hex(PDF);
  await a.keeper.keepRead(cloudRead(sha), { blockUid: "blk", total: 2 });
  await a.keeper.keepRead(highRead(sha), { blockUid: "blk", total: 2 });
  const highUrl = graph.props.get("blk")[READS_KEY]["builtin:high"].url;
  graph.files.delete(highUrl);
  const b = makeDevice(graph);
  const got = await b.keeper.restoreRead({ blockUid: "blk", getBytes: async () => PDF });
  assert.equal(got.engine, "cloud");
  assert.equal(b.log.warns.length, 1, "logged once");

  const c = makeDevice(graph, { failGet: true });
  assert.equal(await c.keeper.restoreRead({ blockUid: "blk", getBytes: async () => PDF }), null);
  assert.equal(c.log.warns.length, 1, "one warning for two failed fetches");
  assert.equal(c.log.writes, 0);
});

test("a wrong-sha, corrupt, or wrong-schema entry is ignored", async () => {
  const graph = makeGraph();
  const a = makeDevice(graph);
  const sha = await sha256Hex(PDF);
  // Kept for some other PDF: the block's sha filter drops it before any fetch.
  await a.keeper.keepRead(highRead("another-pdf"), { blockUid: "blk", total: 2 });
  const b = makeDevice(graph);
  assert.equal(await b.keeper.restoreRead({ blockUid: "blk", getBytes: async () => PDF }), null);
  assert.equal(b.log.gets.length, 0, "no fetch for a different PDF");

  // Entry claims the right sha but the file holds garbage.
  const props = graph.props.get("blk");
  const entry = { ...props[READS_KEY]["builtin:high"], sha256: sha };
  graph.files.set(entry.url, new TextEncoder().encode("not json"));
  props[READS_KEY] = { "builtin:high": entry };
  const c = makeDevice(graph);
  assert.equal(await c.keeper.restoreRead({ blockUid: "blk", getBytes: async () => PDF }), null);
  assert.deepEqual(await c.store.listParses(sha), []);

  // Valid file whose doc is for another sha, and one with a wrong wrapper schema.
  const wrongDoc = new TextEncoder().encode(JSON.stringify({ schema: READ_SCHEMA, doc: highRead("elsewhere") }));
  graph.files.set(entry.url, wrongDoc);
  assert.equal(await c.keeper.restoreRead({ blockUid: "blk", getBytes: async () => PDF }), null);
  const wrongSchema = new TextEncoder().encode(JSON.stringify({ schema: "pxd-read/99", doc: highRead(sha) }));
  graph.files.set(entry.url, wrongSchema);
  assert.equal(await c.keeper.restoreRead({ blockUid: "blk", getBytes: async () => PDF }), null);
  props[READS_KEY] = { "builtin:high": { ...entry, schema: "pxd-read/99" } };
  assert.equal(await c.keeper.restoreRead({ blockUid: "blk", getBytes: async () => PDF }), null);
  assert.deepEqual(await c.store.listParses(sha), []);
  assert.equal(c.log.writes, 0);
});

test("the same read is not uploaded twice; a newer read of the same engine and mode replaces its entry", async () => {
  const graph = makeGraph();
  const a = makeDevice(graph);
  const doc = cloudRead("sha-i");
  assert.equal((await a.keeper.keepRead(doc, { blockUid: "blk", total: 2 })).ok, true);
  assert.equal(a.log.writes, 2);
  assert.equal((await a.keeper.keepRead(doc, { blockUid: "blk", total: 2 })).reason, "already");
  const other = makeDevice(graph);
  assert.equal((await other.keeper.keepRead(doc, { blockUid: "blk", total: 2 })).reason, "already", "another device sees the note too");
  assert.equal(a.log.writes, 2);
  assert.equal(graph.files.size, 1);

  const newer = { ...cloudRead("sha-i"), stats: { ms: 99 } };
  assert.equal((await a.keeper.keepRead(newer, { blockUid: "blk", total: 2 })).ok, true);
  assert.equal(Object.keys(graph.props.get("blk")[READS_KEY]).length, 1, "same engine and mode: one entry");
  assert.equal(graph.files.size, 2);
});

test("the prop write keeps every unrelated prop, and a read costs at most two writes", async () => {
  const graph = makeGraph();
  const a = makeDevice(graph);
  await a.keeper.keepRead(cloudRead("sha-p"), { blockUid: "blk", total: 2 });
  const after = graph.props.get("blk");
  assert.equal(after[":rf-diagram"], true);
  assert.deepEqual(after.plexus, { v: 2 });
  assert.deepEqual(after.other, { keep: "me" });
  assert.equal(a.log.writes, 2);
  assert.deepEqual(Object.keys(mergeReads({ "cloud:mistral": { url: "u" } }, { engine: "cloud", mode: "llamaparse", url: "x" })).sort(), ["cloud:llamaparse", "cloud:mistral"]);
});

test("the note goes through session.noteRead when the session has it (one undo step)", async () => {
  const graph = makeGraph();
  const a = makeDevice(graph);
  const calls = [];
  const keeper = createReadKeeper({
    host: a.host, store: a.store, now: () => 5,
    session: { async noteRead(uid, entry) { calls.push([uid, entry]); a.log.writes += 1; return { ok: true, writes: 1 }; } },
  });
  const res = await keeper.keepRead(highRead("sha-s"), { blockUid: "blk", total: 2 });
  assert.equal(res.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "blk");
  assert.equal(calls[0][1].engine, "builtin");
  assert.equal(a.log.writes, 2);
});

test("without CompressionStream the read uploads as plain JSON and still restores", async () => {
  const real = globalThis.CompressionStream;
  globalThis.CompressionStream = undefined;
  try {
    const graph = makeGraph();
    const a = makeDevice(graph);
    const sha = await sha256Hex(PDF);
    await a.keeper.keepRead(highRead(sha), { blockUid: "blk", total: 2 });
    assert.match(a.log.uploads[0].name, /\.json$/);
    globalThis.CompressionStream = real;
    const b = makeDevice(graph);
    const got = await b.keeper.restoreRead({ blockUid: "blk", getBytes: async () => PDF });
    assert.equal(got.ocr.mode, "high");
  } finally {
    globalThis.CompressionStream = real;
  }
});

test("a failed upload writes no prop", async () => {
  const graph = makeGraph();
  const a = makeDevice(graph);
  a.host.uploadFile = async () => { throw new Error("upload-unavailable"); };
  const res = await a.keeper.keepRead(cloudRead("sha-f"), { blockUid: "blk", total: 2 });
  assert.equal(res.ok, false);
  assert.equal(graph.props.get("blk")[READS_KEY], undefined);
});

test("no entries on the block: restore does not even hash the PDF", async () => {
  const graph = makeGraph();
  const b = makeDevice(graph);
  let asked = 0;
  assert.equal(await b.keeper.restoreRead({ blockUid: "blk", getBytes: async () => { asked += 1; return PDF; } }), null);
  assert.equal(asked, 0);
});

test("the parse view keeps a finished helper read and restores a kept read into an empty store", async () => {
  const stub = createDomStub();
  const restoreDom = stub.install();
  try {
    const doc = stub.document;
    const sha = await sha256Hex(PDF);
    const graph = makeGraph();
    const a = makeDevice(graph);
    const viewA = createParseView({
      doc, store: a.store, keep: a.keeper, pdfBlockUid: "blk", url: "https://x/y.pdf",
      getPdf: async () => ({ getData: async () => PDF }),
      helper: {
        async health() { return { state: "ready", ocr: true, docling: true, engines: ["docling", "ocr"], version: "0.1.0" }; },
        async parse() { return { doc: doclingRead(sha), job: "j1" }; },
      },
    });
    doc.body.append(viewA.element());
    await viewA.refreshHelper();
    viewA.showDoc(builtinPlain(sha));
    await viewA.parseDocling();
    for (const end = Date.now() + 2000; Date.now() < end && a.log.writes < 2;) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(a.log.writes, 2);
    assert.equal(Object.keys(graph.props.get("blk")[READS_KEY])[0], "docling:helper");

    const b = makeDevice(graph);
    const viewB = createParseView({
      doc, store: b.store, keep: b.keeper, pdfBlockUid: "blk", url: "https://x/y.pdf",
      getPdf: async () => ({ getData: async () => PDF }),
      helper: { async health() { return { state: "not-running" }; }, async parse() { throw new Error("no helper call"); } },
    });
    const found = await viewB.restore();
    assert.equal(found.engine, "docling");
    assert.equal(b.log.writes, 0);
    assert.equal(viewB.hasParse(), true);
  } finally {
    restoreDom();
  }
});

test("parseDocling shows an empty-pdf or rejected-job failure in the pane instead of Nothing matches", async () => {
  const stub = createDomStub();
  const doc = stub.document;
  const sha = await sha256Hex(PDF);
  for (const [error, text] of [
    [Object.assign(new Error("empty-pdf"), { reason: "empty-pdf" }), /downloaded empty/],
    [Object.assign(new Error("job-rejected 400"), { reason: "job-rejected", status: 400 }), /rejected the PDF \(HTTP 400\)/],
  ]) {
    const toasts = [];
    const dev = makeDevice(makeGraph());
    const view = createParseView({
      doc, store: dev.store, keep: dev.keeper, pdfBlockUid: "blk", url: "https://x/y.pdf",
      getPdf: async () => ({ getData: async () => new Uint8Array(0) }),
      onToast: (m) => toasts.push(m),
      helper: {
        async health() { return { state: "ready", ocr: true, docling: true, engines: ["docling"], version: "0.1.0" }; },
        async parse() { throw error; },
      },
    });
    doc.body.append(view.element());
    await view.refreshHelper();
    view.showDoc(builtinPlain(sha));
    await view.parseDocling();
    assert.match(toasts[0], text);
    assert.match(view.element().textContent, text);
  }
});

// WO M hunt, P1 / P2 (~/wo/pxd-r6/hunt-matrix.md).
test("P1: a parse view moved to another PDF drops the old outline, and a read of the old PDF never lands on the new one", async () => {
  const stub = createDomStub();
  const restoreDom = stub.install();
  try {
    const doc = stub.document;
    const sha = await sha256Hex(PDF);
    const graph = makeGraph();
    const a = makeDevice(graph);
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const view = createParseView({
      doc, store: a.store, keep: a.keeper, pdfBlockUid: "blk", url: "https://x/a.pdf",
      getPdf: async () => ({ getData: async () => PDF }),
      helper: {
        async health() { return { state: "ready", ocr: true, docling: true, engines: ["docling", "ocr"], version: "0.1.0" }; },
        // A helper whose answer arrives although the browser stopped waiting.
        async parse() { await gate; return { doc: doclingRead(sha), job: "j1" }; },
      },
    });
    doc.body.append(view.element());
    await view.refreshHelper();
    view.showDoc(builtinPlain(sha));
    const run = view.parseDocling();
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(view.isBusy(), true);
    view.setTarget({ url: "https://x/b.pdf", pdfUid: "cardB" });
    assert.equal(view.hasParse(), false, "B does not show A's outline");
    assert.equal(view.isBusy(), false, "A's read is cancelled");
    release();
    await run;
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(await a.store.findByUrl("https://x/b.pdf"), null, "B's url is not indexed to A's parse");
    assert.equal(graph.props.get("blk")[READS_KEY], undefined, "A's read is not kept under B's block");
    assert.equal(view.hasParse(), false);
    // Same url again: nothing is dropped.
    view.showDoc(builtinPlain(sha));
    view.setTarget({ url: "https://x/b.pdf", pdfUid: "cardB" });
    assert.equal(view.hasParse(), true);
  } finally {
    restoreDom();
  }
});

test("P2: a Docling run replaced by a newer run leaves the newer run's phase alone", async () => {
  const stub = createDomStub();
  const restoreDom = stub.install();
  try {
    const doc = stub.document;
    const sha = await sha256Hex(PDF);
    const dev = makeDevice(makeGraph());
    const gates = [];
    const view = createParseView({
      doc, store: dev.store, keep: dev.keeper, pdfBlockUid: "blk", url: "https://x/y.pdf",
      getPdf: async () => ({ getData: async () => PDF }),
      helper: {
        async health() { return { state: "ready", ocr: true, docling: true, engines: ["docling", "ocr"], version: "0.1.0" }; },
        parse({ signal }) {
          return new Promise((resolve, reject) => {
            gates.push(() => resolve({ doc: doclingRead(sha), job: "j" }));
            signal?.addEventListener?.("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
          });
        },
      },
    });
    doc.body.append(view.element());
    await view.refreshHelper();
    view.showDoc(builtinPlain(sha));
    const first = view.parseDocling();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = view.parseDocling();
    assert.equal(await first, null);
    assert.equal(view.isBusy(), true, "the second run is still running");
    await new Promise((resolve) => setTimeout(resolve, 5));
    gates.at(-1)();
    assert.equal(await second, true);
    assert.equal(view.isBusy(), false);
  } finally {
    restoreDom();
  }
});
