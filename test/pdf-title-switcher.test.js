// PDF titles: junk parsed/metadata titles never show, and the switcher repaints when a title arrives.
import assert from "node:assert/strict";
import test from "node:test";

import { parsedDocTitle } from "../src/model/pdf.js";
import { createReadPane } from "../src/view/read-pane.js";
import { createDomStub } from "./fixtures/dom-stub.js";

test("parsedDocTitle skips a junk doc.title and falls through to the first heading", () => {
  const doc = { title: "I", order: ["h", "p"], blocks: { h: { type: "heading", level: 1, text: "Commission Regulation" }, p: { type: "para", page: 1, text: "Body" } } };
  assert.equal(parsedDocTitle(doc), "Commission Regulation");
  assert.equal(parsedDocTitle({ ...doc, title: "Microsoft Word - Report v2" }), "Report v2");
  assert.equal(parsedDocTitle({ ...doc, title: "Science of the Total Environment" }), "Science of the Total Environment");
  assert.equal(parsedDocTitle({ order: ["h"], blocks: { h: { type: "heading", level: 1, text: "II" } } }), "");
});

test("the switcher options update after a title promise resolves and none is junk", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const root = doc.createElement("div");
    root.className = "pxd-root";
    doc.body.append(root);
    const names = { a: "PDF", b: "I" };
    const cards = [{ uid: "a", kind: "pdf", string: "{{[[pdf]]: https://x.test/a.pdf}}" }, { uid: "b", kind: "pdf", string: "{{[[pdf]]: https://x.test/b.pdf}}" }];
    const pane = createReadPane({
      doc, root, storage: stub.localStorage, host: { renderBlock() {}, unmount() {} },
      cards: () => cards,
      titleOf: (card) => names[card.uid],
    });
    pane.open({ blockUid: "blk", cardUid: "a", title: "PDF", source: cards[0].string });
    const options = () => pane.element().querySelectorAll(".pxd-read__switch option").map((o) => o.textContent);
    await Promise.resolve().then(() => { names.a = "Science of the Total Environment"; names.b = "Microbiological criteria"; });
    pane.refreshCards();
    assert.deepEqual(options(), ["Science of the Total Environment", "Microbiological criteria"]);
    assert.equal(options().includes("I"), false);
    pane.dispose();
  } finally {
    restore();
  }
});
