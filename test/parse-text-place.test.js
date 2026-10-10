import test from "node:test";
import assert from "node:assert/strict";
import { alignVlmText, placePageText } from "../src/model/parse/vlm-tables.js";

test("placePageText cuts the transcription where each host's own Vision words begin", () => {
  const hosts = [
    { text: "CHAPTER THREE", bbox: [0, 0, 100, 12] },
    { text: "The committee met on Tuesday and resolved that the accounts be audited before the annual meeting in October", bbox: [0, 14, 100, 60] },
    { text: "Minutes 1867", bbox: [0, 62, 100, 72] },
  ];
  const parts = placePageText(
    "Chapter Three The committee met on Tuesday and resolved that the accounts be audited before the annual meeting in October. Minutes 1867",
    hosts,
  );
  assert.deepEqual(parts, [
    "Chapter Three",
    "The committee met on Tuesday and resolved that the accounts be audited before the annual meeting in October.",
    "Minutes 1867",
  ]);
  // An equal share would have put six words on the heading.
  assert.equal(parts[0].split(" ").length, 2);
});

test("placePageText gives a host that Vision could not read the words between its anchored neighbours", () => {
  const hosts = [
    { text: "Dear Mrs Dana", bbox: [0, 0, 100, 10] },
    { text: "ltw ouq xzq", bbox: [0, 12, 100, 40] },
    { text: "Annie Fields", bbox: [0, 42, 100, 50] },
  ];
  const parts = placePageText("26 March 1867. Dear Mrs. Dana, we shall be most happy to welcome you. Yours truly Annie Fields.", hosts);
  assert.equal(parts[0], "26 March 1867. Dear Mrs. Dana,");
  assert.equal(parts[1], "we shall be most happy to welcome you. Yours truly");
  assert.equal(parts[2], "Annie Fields.");
  assert.equal(parts.join(" ").split(/\s+/).length, 18);
});

test("placePageText near spellings anchor a long word and a lone short word is no anchor", () => {
  const near = placePageText("Introduction to the sample. The results of the measurements follow.", [
    { text: "Introducton to the sarnple", bbox: [0, 0, 100, 10] },
    { text: "Resu1ts of the measurernents", bbox: [0, 42, 100, 50] },
  ]);
  assert.deepEqual(near, ["Introduction to the sample.", "The results of the measurements follow."]);
  const stray = placePageText("Report of the Harbour Commissioners for the year", [
    { text: "the", bbox: [0, 0, 100, 10] },
    { text: "Report of the Harbour Commissioners", bbox: [0, 12, 100, 40] },
  ]);
  assert.deepEqual(stray, ["", "Report of the Harbour Commissioners for the year"]);
  const number = placePageText("Minutes of the meeting. Page 4", [
    { text: "Minutes of the meeting", bbox: [0, 0, 100, 10] },
    { text: "Page 4", bbox: [0, 12, 100, 20] },
  ]);
  assert.deepEqual(number, ["Minutes of the meeting.", "Page 4"]);
});

test("placePageText with no match shares by Vision word count, then by height, then equally", () => {
  assert.deepEqual(placePageText("one two three", [{ text: "vision late" }, { text: "vision early" }]), ["one two", "three"]);
  assert.deepEqual(placePageText("a b c d e f", [{ text: "x y z w", bbox: [0, 0, 10, 10] }, { text: "q r" }]), ["a b c d", "e f"]);
  assert.deepEqual(placePageText("a b c d e f", [{ text: "", bbox: [0, 0, 10, 10] }, { text: "", bbox: [0, 0, 10, 50] }]), ["a", "b c d e f"]);
  assert.deepEqual(placePageText("a b c d", [{ text: "" }, { text: "" }]), ["a b", "c d"]);
  assert.deepEqual(placePageText("", [{ text: "x" }, { text: "y" }]), ["", ""]);
  assert.deepEqual(placePageText("x", []), []);
});

test("alignVlmText places a page transcription by alignment and reports the reads", () => {
  const doc = {
    order: ["h", "p", "n"],
    blocks: {
      h: { id: "h", type: "heading", page: 1, bbox: [0, 0, 100, 12], text: "REPORT" },
      p: { id: "p", type: "para", page: 1, bbox: [0, 14, 100, 60], text: "The harbour works were finished in the spring" },
      n: { id: "n", type: "footnote", page: 1, bbox: [0, 62, 100, 72], text: "Page 4" },
    },
  };
  const out = alignVlmText(doc, [{ page: 1, bbox: [0, 0, 100, 80], text: "Report The harbour works were finished in the spring of 1902. Page 4", pageText: true }]);
  assert.equal(out.doc.blocks.h.text, "Report");
  assert.equal(out.doc.blocks.p.text, "The harbour works were finished in the spring of 1902.");
  assert.equal(out.doc.blocks.n.text, "Page 4");
  assert.deepEqual(out.doc.blocks.p.bbox, doc.blocks.p.bbox);
  assert.equal(out.reads.length, 1);
  assert.deepEqual(out.reads[0].hosts.map((host) => host.id), ["h", "p", "n"]);
  assert.equal(out.reads[0].hosts[1].vision, "The harbour works were finished in the spring");
  assert.equal(alignVlmText(doc, [{ page: 1, bbox: [0, 0, 100, 80], text: "Report only", pageText: false }]).reads.length, 0);
});
