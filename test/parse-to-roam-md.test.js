import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { SCHEMA, tableFromTruth, tableGrid } from "../src/model/parse-schema.js";
import { ESCAPES, escapeMarkdownText, flattenLine, toRoamMarkdown } from "../src/model/parse-to-roam-md.js";

const truth = JSON.parse(readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures/pdf/report.truth.json"),
  "utf8",
));

const HEADER = [
  "- {{[[table]]}}",
  "  - Product stage",
  "    - Organism",
  "      - Sampling plan",
  "        - ",
  "          - ",
  "            - ",
  "              - Action",
  "  - ",
  "    - ",
  "      - n",
  "        - c",
  "          - m (CFU/g)",
  "            - M (CFU/g)",
  "              - ",
].join("\n");

function bullets(markdown) {
  return markdown.split("\n").map((line) => {
    const match = /^( *)- (.*)$/.exec(line);
    assert.ok(match, line);
    return { depth: match[1].length / 2, text: match[2] };
  });
}

test("Table 1 merges become empty covered cells in flat Roam chains", () => {
  const table = tableFromTruth(truth.tables[0], { id: "t1", page: 2 });
  table.caption = null;
  const doc = { schema: SCHEMA, order: ["t1"], blocks: { t1: table } };
  const out = toRoamMarkdown(doc, ["t1"]);
  assert.equal(out.placeholders.length, 0);
  assert.equal(out.blockEstimate, 1 + 7 * 7);
  assert.equal(out.markdown.startsWith(HEADER), true, out.markdown.slice(0, 400));
  const rows = bullets(out.markdown).slice(1);
  const grid = tableGrid(table);
  assert.equal(rows.length, 49);
  grid.forEach((row, r) => {
    row.forEach((slot, c) => {
      const bullet = rows[r * 7 + c];
      assert.equal(bullet.depth, 1 + c, `${r},${c}`);
      assert.equal(bullet.text, slot.covered ? "" : slot.text, `${r},${c} ${slot.text}`);
    });
  });
});

test("a heading, paragraph, list, formula, and footnote mix", () => {
  const doc = {
    schema: SCHEMA,
    order: ["h", "p", "l", "e", "n"],
    blocks: {
      h: { id: "h", type: "heading", level: 1, page: 1, text: "Environmental Monitoring of a Dry-Blend Powder Line" },
      p: { id: "p", type: "para", page: 1, text: "See note³", footnoteRefs: [{ mark: "3", at: 8, to: "n" }] },
      l: {
        id: "l",
        type: "list",
        ordered: true,
        page: 1,
        items: [
          { text: "Swab the zone", level: 0, marker: "1." },
          { text: "Record CFU", level: 1, marker: "a." },
        ],
      },
      e: { id: "e", type: "formula", page: 1, latex: "R = w_z\\cdot(1+m)+2h", number: "(1)" },
      n: { id: "n", type: "footnote", page: 1, mark: "3", text: "Zone three." },
    },
  };
  const inline = toRoamMarkdown(doc);
  assert.equal(inline.markdown, [
    "- # Environmental Monitoring of a Dry-Blend Powder Line",
    "- See note[3]",
    "- [3] Zone three.",
    "- • 1. Swab the zone",
    "  - • a. Record CFU",
    "- $$R = w_z\\cdot(1+m)+2h$$ (1)",
  ].join("\n"));
  assert.equal(inline.blockEstimate, 6);

  const end = toRoamMarkdown(doc, null, { footnotes: "end" });
  assert.equal(end.markdown.endsWith("- [3] Zone three."), true);
  assert.equal(end.markdown.split("\n")[2], "- • 1. Swab the zone");

  const numbered = toRoamMarkdown(doc, ["l"], { numbered: true });
  assert.equal(numbered.markdown, "- 1. Swab the zone\n  - 1. a. Record CFU");
});

const para = (id, text) => ({ id, type: "para", page: 1, text });
const one = (text, options) => toRoamMarkdown({
  schema: SCHEMA,
  order: ["a"],
  blocks: { a: para("a", text) },
}, null, options);

test("link-safe wraps page tokens, block refs, and a leading attribute name", () => {
  const safe = toRoamMarkdown({
    schema: SCHEMA,
    order: ["a", "b", "c"],
    blocks: {
      a: para("a", "Rank #1"),
      b: para("b", "See [[Page]] and ((uid))"),
      c: para("c", "Name:: Ada"),
    },
  });
  assert.equal(safe.markdown, [
    "- Rank `#1`",
    "- See `[[Page]]` and `((uid))`",
    "- `Name::` Ada",
  ].join("\n"));
});

test("measured rules: leading list, quote, and bold markers need no escape and no placeholder", () => {
  for (const text of ["- not a list", "* x", "+ x", "1. x", "> quote", "|", "**bold**", "$$x$$"]) {
    const out = one(text);
    assert.equal(out.markdown, `- ${text}`, text);
    assert.deepEqual(out.placeholders, []);
  }
});

test("measured rules: a leading #, fence, or --- gets one backslash", () => {
  assert.equal(one("# not a heading").markdown, "- \\# not a heading");
  assert.equal(one("## two").markdown, "- \\## two");
  assert.equal(one("```code").markdown, "- \\```code");
  assert.equal(one("---").markdown, "- \\---");
  assert.equal(one("--- x").markdown, "- \\--- x");
  assert.equal(one("a --- b").markdown, "- a --- b");
});

test("measured rules: a backslash before a consumed character is doubled, otherwise kept", () => {
  assert.equal(one("a\\.b").markdown, "- a\\\\.b");
  assert.equal(one("C:\\foo").markdown, "- C:\\foo");
  assert.equal(one("a\\\\b").markdown, "- a\\\\\\b");
  assert.equal(one("\\# x").markdown, "- \\\\# x");
  assert.equal(escapeMarkdownText("a\\*b"), "a\\\\*b");
  for (const ch of ESCAPES.consumed) {
    assert.equal(escapeMarkdownText(`x\\${ch}`), `x\\\\${ch}`, ch);
  }
});

test("with a structural prefix only the doubling applies; a heading's #1 is link-wrapped, so no leading escape", () => {
  const heading = toRoamMarkdown({
    schema: SCHEMA,
    order: ["h"],
    blocks: { h: { id: "h", type: "heading", level: 1, page: 1, text: "#1 priority" } },
  });
  assert.equal(heading.markdown, "- # `#1` priority");
  const plain = toRoamMarkdown({
    schema: SCHEMA,
    order: ["h"],
    blocks: { h: { id: "h", type: "heading", level: 2, page: 1, text: "# x\\.y" } },
  }, null, { linkSafe: false });
  assert.equal(plain.markdown, "- ## # x\\\\.y");
});

test("tabs and newlines flatten to single spaces and control characters drop", () => {
  assert.equal(flattenLine("  a\tb\r\nc\u0000\u0007  d\u00a0 e  "), "a b c d e");
  assert.equal(one("a\tb\nc\r\n\nd").markdown, "- a b c d");
});

test("a code block body cannot break its fence, and placeholders stay empty", () => {
  const out = toRoamMarkdown({
    schema: SCHEMA,
    order: ["c"],
    blocks: { c: { id: "c", type: "code", page: 1, text: "a ``` b" } },
  });
  assert.equal(out.markdown, "- ```a ''' b```");
  assert.deepEqual(out.placeholders, []);
  assert.equal(out.blockEstimate, 1);
});

test("linkSafe false leaves page links alone", () => {
  const raw = toRoamMarkdown({
    schema: SCHEMA,
    order: ["a"],
    blocks: { a: para("a", "See [[Page]]") },
  }, null, { linkSafe: false });
  assert.equal(raw.markdown, "- See [[Page]]");
});