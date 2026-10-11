import assert from "node:assert/strict";
import test from "node:test";

import * as liveai from "../src/host/liveai.js";
import { answerCardMarkdown, DOC_INSTRUCTIONS, INSTRUCTIONS, MULTI_INSTRUCTIONS, parseAnswer, withImageInstructions } from "../src/model/ai-context.js";
import { findSourceCard } from "../src/model/ask-basket.js";
import { createParseActions } from "../src/view/parse-actions.js";
import { paintAnswer } from "../src/view/ask-ai.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const OUTLINE = [
  "Comparison:",
  "",
  "- {{[[table]]}}",
  "  - Organism",
  "    - Our Table 1",
  "      - EU 2073/2005",
  "        - Gap",
  "  - Salmonella",
  "    - Finished blend: **n=5** [Part 1, p. 3]",
  "      - Point 1.22: `absent` in 25 g [Part 2, p. 10]",
  "        - No gap [p. 4]",
].join("\n");

const MD = "| Organism | Ours | EU |\n|---|---|---|\n| Salmonella | n=5 | **absent** [p. 4] |\n| Listeria | n=1 | none |";

function walk(node, fn) { fn(node); for (const k of node.children || []) walk(k, fn); }
const all = (node, tag) => { const out = []; walk(node, (n) => { if (n.tagName?.toLowerCase() === tag) out.push(n); }); return out; };

test("liveai.ask turns the default Live AI system prompt off when Plexus sends its own", async () => {
  let seen = null;
  const w = { LiveAI_API: { isAvailable: () => true, generate: async (o) => { seen = o; return { text: "x" }; } } };
  await liveai.ask({ prompt: "Q", systemPrompt: "SYS", window: w });
  assert.equal(seen.useDefaultSystemPrompt, false);
  await liveai.ask({ prompt: "Q", window: w });
  assert.equal(seen.useDefaultSystemPrompt, undefined);
});

test("every instruction variant asks for plain Markdown and forbids Roam syntax", () => {
  for (const text of [INSTRUCTIONS, DOC_INSTRUCTIONS, MULTI_INSTRUCTIONS, withImageInstructions(INSTRUCTIONS)]) {
    assert.match(text, /Write plain Markdown\. For comparisons use a Markdown table/);
    assert.match(text, /Never use Roam syntax such as \{\{\[\[table\]\]\}\}/);
  }
});

test("parseAnswer reads a Markdown table and a Roam table outline (4 columns, header + 2 rows)", () => {
  const md = parseAnswer(MD).find((p) => p.type === "table");
  assert.deepEqual(md.rows[0], ["Organism", "Ours", "EU"]);
  assert.equal(md.rows.length, 3);
  const outline = parseAnswer(OUTLINE);
  assert.equal(outline[0].type, "p");
  const table = outline[1];
  assert.equal(table.type, "table");
  assert.equal(table.rows.length, 2);
  assert.deepEqual(table.rows[0], ["Organism", "Our Table 1", "EU 2073/2005", "Gap"]);
  assert.equal(table.rows[1].length, 4);
  assert.match(table.rows[1][1], /Finished blend: \*\*n=5\*\* \[Part 1, p\. 3\]/);
});

test("a flattened {{[[table]]}} line with loose cell lines is not rebuilt and does not crash", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = globalThis.document;
    const node = doc.createElement("div");
    paintAnswer(doc, node, "- {{[[table]]}}\n- A\n- B\n- C", () => {});
    assert.equal(all(node, "table").length, 0);
    assert.match(node.textContent, /\{\{\[\[table\]\]\}\}/);
  } finally {
    restore();
  }
});

test("paintAnswer draws Markdown tables and Roam outlines as a real table with inline formatting and citations", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = globalThis.document;
    for (const [text, rows, cols] of [[MD, 3, 3], [OUTLINE, 2, 4]]) {
      const node = doc.createElement("div");
      const pages = [];
      paintAnswer(doc, node, text, (n) => pages.push(n));
      const tables = all(node, "table");
      assert.equal(tables.length, 1);
      assert.equal(tables[0].className, "pxd-ask__table");
      assert.equal(all(tables[0], "tr").length, rows);
      assert.equal(all(tables[0], "th").length, cols);
      assert.equal(all(tables[0], "td").length, (rows - 1) * cols);
      assert.ok(all(tables[0], "strong").length >= 1);
    }
  } finally {
    restore();
  }
});

test("Add as card: a Markdown table and a Roam outline both become a real {{[[table]]}} block with row chains", () => {
  const card = answerCardMarkdown({ answer: OUTLINE, chip: null }).split("\n");
  const at = card.indexOf("- {{[[table]]}}");
  assert.ok(at > 0);
  assert.equal(card[at + 1], "  - Organism");
  assert.equal(card[at + 2], "    - Our Table 1");
  assert.equal(card[at + 4], "        - Gap");
  assert.match(card[at + 5], /^  - Salmonella$/);
  assert.ok(!card.some((l) => /`\{\{/.test(l) || /\\\{\{/.test(l)));
  const md = answerCardMarkdown({ answer: MD }).split("\n");
  const t = md.indexOf("- {{[[table]]}}");
  assert.deepEqual(md.slice(t + 1, t + 4), ["  - Organism", "    - Ours", "      - EU"]);
  assert.equal(md[t + 4], "  - Salmonella");
});

test("findSourceCard falls back to the PDF card whose source URL equals the part url", () => {
  const url = "https://firebasestorage.example/report.pdf";
  const items = [
    { uid: "pxdLab00", kind: "pdf", string: `{{[[pdf]]: ${url}}}` },
    { uid: "pxdLab04", kind: "pdf", string: "{{[[pdf]]: https://firebasestorage.example/eu.pdf}}" },
    { uid: "note", kind: "note", string: `{{[[pdf]]: ${url}}}` },
  ];
  assert.equal(findSourceCard(items, { pinUid: "pin-1", pdfUid: "block-uid", url }), "pxdLab00");
  assert.equal(findSourceCard(items, { pdfUid: "block-uid", url: "https://other/x.pdf" }), "");
  assert.equal(findSourceCard(items, { url, pdfSourceOf: (it) => (it.uid === "pxdLab04" ? `{{[[pdf]]: ${url}}}` : "") }), "pxdLab04");
});

test("answer card draws the source edge for a part that only carries the PDF url", async () => {
  const url = "https://firebasestorage.example/report.pdf";
  const items = [{ uid: "pxdLab00", kind: "pdf", string: `{{[[pdf]]: ${url}}}` }, { uid: "pxdLab04", kind: "pdf", string: "{{[[pdf]]: https://x/eu.pdf}}" }];
  const edges = [];
  const session = {
    board: { items: new Map(items.map((it) => [it.uid, it])) },
    ensurePdfPin: async (spec) => ({ ok: true, uid: `pin-${spec.page}` }),
    insertParsedCard: async () => { session.board.items.set("ans", { uid: "ans", kind: "note" }); return { ok: true, uid: "ans" }; },
    addEdge: async (e) => { edges.push(e); },
  };
  const actions = createParseActions({ session, placeBeside: () => ({ x: 0, y: 0 }) });
  await actions.insertAnswerCard({
    markdown: "- AI answer",
    sources: [
      { pdfUid: "pdf-block-uid", url, pin: { pdfUid: "pdf-block-uid", page: 3, frac: [0, 0, 1, 1] } },
      { pdfUid: "pxdLab04", sourceUid: "pxdLab04" },
    ],
  });
  assert.deepEqual(edges.map((e) => [e.from, e.to]), [["ans", "pxdLab00"], ["ans", "pxdLab04"]]);
});
