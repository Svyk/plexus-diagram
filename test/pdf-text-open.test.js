import assert from "node:assert/strict";
import test from "node:test";

import { openPdfDocument, unparsedPdfJobs } from "../src/host/pdf-text-open.js";

function libOf() {
  const destroyed = [];
  const opened = [];
  const lib = {
    getDocument(spec) {
      opened.push(spec.url);
      const pdf = {
        numPages: 2,
        async getPage(n) {
          return {
            async getTextContent() {
              return { items: [{ str: n === 1 ? "Brain age" : "Methods", transform: [1, 0, 0, 1, 10, 400], width: 40, height: 10 }] };
            },
            getViewport() { return { width: 200, height: 500 }; },
          };
        },
        async destroy() { destroyed.push("pdf"); },
      };
      return { promise: Promise.resolve(pdf), async destroy() { destroyed.push("task"); } };
    },
  };
  return { lib, destroyed, opened };
}

test("unparsedPdfJobs skips parsed urls and files the reader cannot open", () => {
  const rows = [{ kind: "paragraph", url: "https://x/parsed.pdf", text: "brain" }, { kind: "figure", url: "https://x/fig.pdf", text: "plot" }];
  const blocks = [
    { uid: "a", url: "https://x/parsed.pdf", pageTitle: "Parsed" },
    { uid: "b", url: "https://x/new.pdf", pageTitle: "New" },
    { uid: "c", url: "https://x/secret.enc", pageTitle: "Enc" },
    { uid: "d", url: "file:///tmp/local.pdf", pageTitle: "Local" },
  ];
  const allow = (url) => /^https?:/i.test(url) && !/\.enc(?:[?#]|$)/i.test(url);
  assert.deepEqual(unparsedPdfJobs(rows, blocks, allow), [{ url: "https://x/new.pdf", pdfUid: "b", title: "New" }]);
});

test("openPdfDocument reads a page through pdf.js and closes the file", async () => {
  const { lib, destroyed, opened } = libOf();
  const handle = await openPdfDocument(lib, "https://x/new.pdf", { allow: (url) => url.startsWith("https://") });
  assert.deepEqual(opened, ["https://x/new.pdf"]);
  assert.equal(handle.pageCount, 2);
  assert.match(handle.hash, /^[0-9a-f]{64}$/);
  const page = await handle.readPage(1);
  assert.equal(page.n, 1);
  assert.match(page.text, /Brain age/);
  assert.equal(page.spans[0].frac.length, 4);
  await handle.close();
  assert.deepEqual(destroyed, ["pdf", "task"]);
  const blocked = libOf();
  assert.equal(await openPdfDocument(blocked.lib, "https://x/secret.enc", { allow: () => false }), null);
  assert.deepEqual(blocked.opened, []);
});
