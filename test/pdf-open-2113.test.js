import assert from "node:assert/strict";
import test from "node:test";

import { pdfCardForUrl, writeReaderPage } from "../src/model/pdf.js";

const A = "{{[[pdf]]: https://example.test/a.pdf}}";
const B = "{{[[pdf]]: https://example.test/b.pdf}}";

test("pdfCardForUrl matches the macro url and skips a ref string", () => {
  const cards = [
    { uid: "refcard1", source: "((pdfblock))" },
    { uid: "pdfcard1", source: A },
    { uid: "pdfcard2", source: A },
  ];
  assert.equal(pdfCardForUrl("https://example.test/a.pdf", cards), "pdfcard1");
  assert.equal(pdfCardForUrl("https://example.test/b.pdf", [{ uid: "other", source: B }]), "other");
  assert.equal(pdfCardForUrl("https://example.test/missing.pdf", cards), null);
  assert.equal(pdfCardForUrl("", cards), null);
});

test("writeReaderPage uses the prototype setter and rejects page 0", () => {
  const seen = [];
  const input = {
    dispatchEvent(event) { seen.push(event.type); },
  };
  const previous = globalThis.HTMLInputElement;
  class HTMLInputElement {}
  Object.defineProperty(HTMLInputElement.prototype, "value", {
    configurable: true,
    set(value) { seen.push(["set", value]); },
  });
  globalThis.HTMLInputElement = HTMLInputElement;
  try {
    assert.equal(writeReaderPage(input, 2), true);
    assert.deepEqual(seen, [["set", "2"], "input", "change"]);
    assert.equal(writeReaderPage(input, 0), false);
    assert.equal(seen.length, 3);
  } finally {
    if (previous === undefined) delete globalThis.HTMLInputElement;
    else globalThis.HTMLInputElement = previous;
  }
});
