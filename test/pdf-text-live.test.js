import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { openPdfForText, pdfJsForText } from "../src/view/pdf-js-for-text.js";

const lib = (workerSrc) => ({
  getDocument() { return { promise: Promise.resolve(null) }; },
  GlobalWorkerOptions: workerSrc ? { workerSrc } : {},
});

function frame(win) {
  return { contentWindow: win };
}

test("pdf.js is used without a worker, and a reader frame with a worker wins", () => {
  const bare = { pdfjsLib: lib("") };
  const found = pdfJsForText(bare, { querySelectorAll: () => [] });
  assert.equal(found.lib, bare.pdfjsLib);
  assert.equal(found.workerReady, false);

  const reader = { pdfjsLib: lib("https://roamresearch.com/pdf.worker.js") };
  let thrown = 0;
  const doc = {
    querySelectorAll: () => [
      { get contentWindow() { thrown += 1; throw new Error("cross-origin"); } },
      frame(reader),
    ],
  };
  const ready = pdfJsForText({ pdfjsLib: lib("") }, doc);
  assert.equal(ready.lib, reader.pdfjsLib);
  assert.equal(ready.workerReady, true);
  assert.equal(thrown, 1);
  assert.equal(pdfJsForText({}, { querySelectorAll: () => [] }), null);
});

test("opening a PDF retries when pdf.js has no worker and drops a bad file when the worker is ready", async () => {
  const calls = [];
  const bare = pdfJsForText({ pdfjsLib: lib("") }, { querySelectorAll: () => [] });
  const again = await openPdfForText({
    url: "https://x.test/cureus.pdf",
    allow: () => true,
    found: bare,
    open: async (got) => { calls.push(got); return null; },
  });
  assert.equal(calls[0], bare.lib);
  assert.equal(again.retry, true);

  const missing = await openPdfForText({
    url: "https://x.test/cureus.pdf",
    allow: () => true,
    found: null,
    open: async () => { throw new Error("no lib"); },
  });
  assert.equal(missing.retry, true);
  assert.equal(calls.length, 1);

  const blocked = await openPdfForText({
    url: "https://x.test/secret.pdf.enc",
    allow: (url) => !/\.enc(?:[?#]|$)/i.test(url),
    found: bare,
    open: async () => { calls.push("enc"); return { pageCount: 1 }; },
  });
  assert.equal(blocked, null);
  assert.equal(calls.length, 1);

  const ready = pdfJsForText(
    { pdfjsLib: lib("https://roamresearch.com/pdf.worker.js") },
    { querySelectorAll: () => [] },
  );
  const bad = await openPdfForText({
    url: "https://x.test/bad.pdf",
    allow: () => true,
    found: ready,
    open: async () => null,
  });
  assert.equal(bad, null);

  const handle = { pageCount: 2, readPage: async () => null };
  const opened = await openPdfForText({
    disposed: false,
    url: "https://x.test/ok.pdf",
    allow: () => true,
    found: bare,
    open: async () => handle,
  });
  assert.equal(opened, handle);
  const closed = await openPdfForText({ disposed: true, url: "https://x.test/ok.pdf", found: bare, open: async () => handle });
  assert.equal(closed, null);
});

test("the board starts the text feed on open and publishes the debug counter", () => {
  const board = readFileSync(new URL("../src/view/board-view.js", import.meta.url), "utf8");
  const feature = readFileSync(new URL("../src/feature.js", import.meta.url), "utf8");
  const helper = readFileSync(new URL("../src/view/pdf-js-for-text.js", import.meta.url), "utf8");
  assert.match(board, /openPdfForText\(/);
  assert.match(board, /pdfJsForText\(/);
  assert.match(board, /pdfTextIndex\(\)\.search\(/);
  assert.match(board, /pdfTextIndex\(\)\.noteParsed\(/);
  assert.match(board, /pdfTextStats\(\)/);
  assert.match(board, /timers\.later\(\(\) => \{\s*stopPdfTextFeed = null;/);
  assert.equal(helper.includes("workerSrc ="), false);
  assert.match(feature, /pdfText\(\)/);
});
