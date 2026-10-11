import assert from "node:assert/strict";
import test from "node:test";

import {
  answerCardMarkdown,
  buildFocusContext,
  chipText,
  findSelectionBlock,
  INSTRUCTIONS,
  previewText,
  selectionDoc,
  splitCitations,
} from "../src/model/ai-context.js";

function fixture() {
  const blocks = {
    t: { id: "t", type: "heading", level: 1, page: 1, text: "Annual Report" },
    h1: { id: "h1", type: "heading", level: 1, page: 1, text: "Results" },
    p1: { id: "p1", type: "para", page: 2, text: "Revenue grew in the second half." },
    p2: { id: "p2", type: "para", page: 2, text: "Costs were flat." },
    h2: { id: "h2", type: "heading", level: 2, page: 3, text: "Regional split" },
    p3: { id: "p3", type: "para", page: 3, text: "North led all regions." },
    p4: { id: "p4", type: "para", page: 3, text: "South trailed." },
    tab: {
      id: "tab", type: "table", page: 3, rows: 2, cols: 2,
      cells: [
        { r: 0, c: 0, text: "Region", header: true }, { r: 0, c: 1, text: "Sales", header: true },
        { r: 1, c: 0, text: "North" }, { r: 1, c: 1, text: "41" },
      ],
    },
    cap: { id: "cap", type: "caption", for: "tab", page: 3, text: "Table 3. Sales by region" },
    p5: { id: "p5", type: "para", page: 3, text: "East is new." },
    p6: { id: "p6", type: "para", page: 4, text: "West is closed." },
    p7: { id: "p7", type: "para", page: 4, text: "Outlook is stable." },
    fig: { id: "fig", type: "figure", page: 4, caption: "figcap", text: "axis 0 10 20" },
    figcap: { id: "figcap", type: "caption", page: 4, text: "Figure 2. Trend" },
  };
  return {
    schema: "pxd-parse/1",
    pages: [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }],
    order: ["t", "h1", "p1", "p2", "h2", "p3", "p4", "tab", "cap", "p5", "p6", "p7", "fig", "figcap"],
    blocks,
  };
}

test("table focus: markdown table, caption, chip, section chain, page citations", () => {
  const out = buildFocusContext(fixture(), { blockId: "tab" });
  assert.match(out.context, /=== FOCUS ===/);
  assert.match(out.context, /\| Region \| Sales \|/);
  assert.match(out.context, /\| North \| 41 \|/);
  assert.match(out.context, /Table 3\. Sales by region/);
  assert.equal(out.chip.label, "Table 3");
  assert.equal(out.chip.page, 3);
  assert.match(chipText(out.chip), /^Table 3 · p\. 3/);
  assert.match(out.context, /Results > Regional split/);
  assert.match(out.instructions, /\[p\. N\]/);
  assert.equal(out.instructions, INSTRUCTIONS);
  assert.match(out.instructions, /focus alone does not support/i);
});

test("merged cells survive as an HTML table", () => {
  const doc = fixture();
  doc.blocks.tab.cells = [
    { r: 0, c: 0, text: "Region", header: true }, { r: 0, c: 1, text: "Sales", header: true },
    { r: 1, c: 0, text: "North", colSpan: 2 },
  ];
  const out = buildFocusContext(doc, { blockId: "tab" });
  assert.match(out.context, /colspan="2"/);
});

test("outline lists headings with pages and tables/figures with captions", () => {
  const out = buildFocusContext(fixture(), { blockId: "p3" });
  assert.match(out.context, /=== DOCUMENT ===/);
  assert.match(out.context, /Title: Annual Report/);
  assert.match(out.context, /Pages: 4/);
  assert.match(out.context, /Regional split \(p\. 3\)/);
  assert.match(out.context, /Table: Table 3\. Sales by region \(p\. 3\)/);
  assert.match(out.context, /Figure: Figure 2\. Trend \(p\. 4\)/);
});

test("nearby window: two paragraphs each side, in reading order, without the focus", () => {
  const out = buildFocusContext(fixture(), { blockId: "p5" });
  const nearby = out.context.split("=== NEARBY ===")[1].split("=== FOCUS ===")[0];
  assert.match(nearby, /North led all regions/);
  assert.match(nearby, /South trailed/);
  assert.match(nearby, /West is closed/);
  assert.match(nearby, /Outlook is stable/);
  assert.doesNotMatch(nearby, /East is new/);
  assert.ok(nearby.indexOf("South trailed") < nearby.indexOf("West is closed"));
  const narrow = buildFocusContext(fixture(), { blockId: "p5" }, { nearbyParas: 1 });
  const n2 = narrow.context.split("=== NEARBY ===")[1].split("=== FOCUS ===")[0];
  assert.match(n2, /South trailed/);
  assert.doesNotMatch(n2, /North led/);
});

test("a table's caption is in NEARBY", () => {
  const out = buildFocusContext(fixture(), { blockId: "tab" });
  const nearby = out.context.split("=== NEARBY ===")[1].split("=== FOCUS ===")[0];
  assert.match(nearby, /Caption of the focus: Table 3/);
});

test("selection focus: the selection plus its containing block", () => {
  const out = buildFocusContext(fixture(), { blockId: "p3", selection: "led all" });
  assert.match(out.context, /Selected text:\n> led all/);
  assert.match(out.context, /North led all regions\./);
  assert.equal(out.chip.label, "Selection");
  const found = buildFocusContext(fixture(), { selection: "Costs were flat", page: 2 });
  assert.match(found.context, /Selected text:\n> Costs were flat/);
  assert.equal(found.chip.page, 2);
});

test("selection with no parse: stand-in document still works", () => {
  const out = buildFocusContext(selectionDoc({ text: "Hello  world", page: 9 }), { blockId: "sel", selection: "Hello world" });
  assert.match(out.context, /> Hello world/);
  assert.equal(out.chip.page, 9);
  assert.equal(findSelectionBlock(fixture(), "nothing like this"), null);
});

test("figure focus: caption plus text inside", () => {
  const out = buildFocusContext(fixture(), { blockId: "fig" });
  assert.match(out.context, /Figure caption: Figure 2\. Trend/);
  assert.match(out.context, /Text inside the figure: axis 0 10 20/);
  assert.equal(out.chip.label, "Figure 2");
});

test("budget: huge outline is trimmed first, then nearby; focus and cap hold", () => {
  const doc = fixture();
  for (let i = 0; i < 2000; i += 1) {
    const id = `x${i}`;
    doc.blocks[id] = { id, type: "heading", level: 2, page: 1 + (i % 4), text: `Generated heading number ${i} with some words` };
    doc.order.push(id);
  }
  const out = buildFocusContext(doc, { blockId: "tab" });
  const outline = out.context.split("=== SECTION ===")[0];
  assert.ok(outline.length <= 1500 * 4 + 200, `outline ${outline.length}`);
  assert.match(outline, /more headings/);
  assert.match(out.context, /\| North \| 41 \|/);
  assert.ok(out.tokensEstimate <= 12000);

  const tight = buildFocusContext(doc, { blockId: "tab" }, { tokenCap: 700 });
  assert.ok(tight.context.length <= 700 * 4, `tight ${tight.context.length}`);
  assert.match(tight.context, /\| North \| 41 \|/);
});

test("a giant focus is trimmed to the cap", () => {
  const doc = fixture();
  doc.blocks.p1.text = "word ".repeat(30000);
  const out = buildFocusContext(doc, { blockId: "p1" });
  assert.ok(out.tokensEstimate <= 12000);
  assert.match(out.context, /focus trimmed to fit/);
});

test("page-only focus and unknown block do not throw", () => {
  const page = buildFocusContext(fixture(), { page: 2 });
  assert.match(page.context, /Revenue grew/);
  assert.match(page.context, /Costs were flat/);
  const none = buildFocusContext(null, { blockId: "zzz" });
  assert.equal(typeof none.context, "string");
  assert.equal(none.tokensEstimate > 0, true);
});

test("tokensEstimate is chars/4 of context plus instructions", () => {
  const out = buildFocusContext(fixture(), { blockId: "p1" });
  assert.equal(out.tokensEstimate, Math.ceil(out.context.length / 4) + Math.ceil(out.instructions.length / 4));
  assert.match(previewText(out), /--- context ---/);
});

test("citations split into links", () => {
  const parts = splitCitations("See [p. 14] and [p. 3, 7] done.");
  assert.deepEqual(parts.map((p) => p.page ?? null), [null, 14, null, 3, null]);
  assert.deepEqual(parts[3].pages, [3, 7]);
  assert.deepEqual(splitCitations("no cites"), [{ text: "no cites" }]);
});

test("answer card: header bullet then one bullet per paragraph", () => {
  const md = answerCardMarkdown({ answer: "First para [p. 3].\n\nSecond.", chip: { label: "Table 3", page: 3, docTitle: "Report" } });
  const lines = md.split("\n");
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^- AI answer · Table 3 · p\. 3 · Report/);
  assert.equal(answerCardMarkdown({ answer: "  " }), "");
});
