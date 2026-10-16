// Lane C fix round 3. Live paste drops the custom card MIME, so every insert and
// paste path has to share one planner. Each entry point has its own assertion.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

import { parseClipboard } from "../src/model/clipboard.js";
import { handleParseDrop } from "../src/model/drop.js";
import { KEPT_PARSE_WAIT_MS, copiedPartPlan, copyMenuPlan, figureCopySize, pasteCardPlan, waitKeptParse } from "../src/model/pdf-pin.js";
import { placementContent, createParseActions } from "../src/view/parse-actions.js";
import { runChipAction } from "../src/view/page-chips.js";

const src = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

const FIGURE_TEXT = "![Figure](https://files/a.png) Figure 1. Long caption that wraps onto a second line of the card.";
const SOURCE = "Source:: ((pinuid01))";

function clip(text) {
  return { getData: (type) => (type === "text/plain" ? text : ""), files: [] };
}

const figureBlock = {
  id: "f1",
  type: "figure",
  page: 1,
  bbox: [0, 0, 400, 220],
  caption: "Figure 1. Presumptive positives per month. Peaks follow wet-clean months and the second line is clipped.",
  image: { url: "https://files/a.png" },
};

test("clipboard text of a copied figure keeps a height above 160", () => {
  const parsed = parseClipboard(clip(`${FIGURE_TEXT}\n${SOURCE}`));
  assert.equal(parsed.kind, "card-json");
  assert.equal(parsed.data.source, "pinuid01");
  assert.ok(parsed.data.size.h > 160, `expected h > 160, got ${parsed.data.size.h}`);
  assert.match(parsed.data.markdown, /!\[[^\]]*\]\(https:\/\/files\/a\.png\)/);
  assert.match(parsed.data.markdown, /Figure 1\./);
  assert.doesNotMatch(parsed.data.markdown, /Source::/);
  assert.doesNotMatch(parsed.data.markdown, /pxd-size::/);

  const sized = parseClipboard(clip(`${FIGURE_TEXT}\npxd-size:: 280 220\n${SOURCE}`));
  assert.equal(sized.data.size.h, 220);
  assert.equal(sized.data.size.w, 280);
  assert.doesNotMatch(sized.data.markdown, /pxd-size::/);
  assert.equal(copiedPartPlan({ markdown: `${FIGURE_TEXT}\n${SOURCE}` }).image, true);
});

test("the gutter chip, the session action, and the shortcut share copiedPartPlan", () => {
  const chips = src("../src/view/page-chips.js");
  assert.match(chips, /copiedPartPlan\(/);
  assert.match(chips, /altKey && event\.shiftKey \? "source"/);
  const seen = [];
  const doc = { blocks: { f1: figureBlock }, order: ["f1"] };
  runChipAction({
    act: "card",
    ids: ["f1"],
    block: figureBlock,
    doc,
    withSource: true,
  }, {
    session: { insertParsedCard: (arg) => { seen.push(arg); } },
    payload: () => ({ ids: ["f1"] }),
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].withSource, true);
  assert.ok(seen[0].h > 160, `chip insert h ${seen[0].h}`);
  assert.equal(seen[0].w, 280);

  const actionsSrc = src("../src/view/parse-actions.js");
  assert.match(actionsSrc, /copiedPartPlan\(/);
  const plain = placementContent(doc, ["f1"], "card");
  const cited = placementContent(doc, ["f1"], "card", null, true);
  assert.equal(plain.content.kind, "figure");
  assert.ok(plain.height > 160, `placement h ${plain.height}`);
  assert.ok(cited.height > plain.height, `source chip did not grow the card (${plain.height} -> ${cited.height})`);

  const menu = copyMenuPlan({ id: "source", block: figureBlock, doc, source: "pinuid01" });
  assert.equal(menu.sourceUid, "pinuid01");
  assert.ok(menu.size.h > 160);
  assert.match(menu.text, /pxd-size:: 280 \d+/);
  assert.match(menu.text, /Source:: \(\(pinuid01\)\)/);
  const pasted = parseClipboard(clip(menu.text));
  assert.ok(pasted.data.size.h > 160, `shortcut paste h ${pasted.data.size.h}`);
  assert.equal(pasted.data.source, "pinuid01");
  const view = src("../src/view/parse-view.js");
  assert.match(view, /copyMenuPlan\(/);
  assert.match(view, /figureCardMarkdown\(live, parsed\)/);
});

test("a figure drop and a parse-actions insert use the shared height", async () => {
  const dropSrc = src("../src/model/drop.js");
  assert.match(dropSrc, /copiedPartPlan\(/);
  const board = src("../src/view/board-view.js");
  const dropAt = board.indexOf("if (list.length === 1 && list[0].parse)");
  const drop = board.slice(dropAt, dropAt + 700);
  assert.match(drop, /gestureSource\(/);
  assert.match(drop, /handleParseDrop\(/);
  const menuAt = board.indexOf("const pasteFromMenu");
  const menu = board.slice(menuAt, board.indexOf("const pasteImages", menuAt));
  assert.match(menu, /parseClipboard\(/);

  const doc = {
    sha256: "sha",
    engine: "builtin",
    optsHash: "opt",
    order: ["f1"],
    blocks: { f1: { ...figureBlock, image: { url: "https://x/f.png" } } },
  };
  const sizes = [];
  const res = await handleParseDrop({
    payload: { sha256: "sha", engine: "builtin", optsHash: "opt", kind: "figure", ids: ["f1"], withSource: true },
    store: { async getParse() { return doc; } },
    session: {
      async insertParsedCard({ w, h }) {
        sizes.push({ w, h });
        return { ok: true, uid: "fig1" };
      },
    },
    point: { x: 4, y: 8 },
  });
  assert.equal(res.ok, true);
  const bare = figureCopySize(doc.blocks.f1, doc, { source: false });
  assert.ok(sizes[0].h > bare.h, `drop h ${sizes[0].h} did not grow past ${bare.h} for the chip`);
  assert.ok(sizes[0].h > 160);

  const seen = [];
  const actions = createParseActions({
    session: { insertParsedCard: async (arg) => { seen.push(arg); return { ok: true, uid: "c1" }; } },
    store: { getParse: async () => doc },
  });
  const inserted = await actions.insertParsedCard({
    sha256: "sha", engine: "builtin", optsHash: "opt", ids: ["f1"], withSource: true, pdfUid: "pdf1",
  });
  assert.equal(inserted.ok, true);
  assert.ok(seen[0].h > 160, `session insert h ${seen[0].h}`);
  assert.equal(seen[0].w, 280);
});

const TABLE_TEXT = [
  "| Zone | Swabs H1 |",
  "| --- | --- |",
  "| 1 | 4 |",
  "| 2 | 8 |",
  "| 3 | 2 |",
  "| 4 | 6 |",
  "| 5 | 1 |",
  "| 6 | 9 |",
  "",
  "Table 2. Swabs",
].join("\n");

test("clipboard text of a copied table pastes as a folded table", () => {
  const parsed = parseClipboard(clip(`${TABLE_TEXT}\n${SOURCE}`));
  assert.equal(parsed.kind, "card-json");
  assert.equal(parsed.data.kind, "table");
  assert.equal(parsed.data.source, "pinuid01");
  assert.equal(parsed.data.caption, "Table 2. Swabs");
  const texts = parsed.data.table.cells.map((cell) => cell.text);
  assert.ok(texts.includes("Zone"));
  assert.ok(texts.includes("Swabs H1"));
  assert.equal(parsed.data.table.cells.filter((cell) => cell.r === 0).length, 2);
  const plan = pasteCardPlan(parsed.data, { x: 12, y: 18 });
  assert.equal(plan.kind, "table");
  assert.equal(plan.caption, "Table 2. Swabs");
  assert.equal(plan.sourceUid, "pinuid01");
  assert.equal(plan.table.cells[0].text, "Zone");
  assert.doesNotMatch(plan.markdown, /pxd-size::/);

  const html = "<table>\n<tr><th rowspan=\"2\">Zone</th><td>Swabs H1</td></tr>\n<tr><td>4</td></tr>\n</table>\n" + SOURCE;
  const spanned = parseClipboard(clip(html));
  assert.equal(spanned.data.kind, "table");
  const zone = spanned.data.table.cells.find((cell) => cell.text === "Zone");
  assert.equal(zone.rowSpan, 2);
  assert.equal(spanned.data.source, "pinuid01");

  const lone = parseClipboard(clip(`| just a pipe\n${SOURCE}`));
  assert.notEqual(lone.data.kind, "table");
  const pipes = parseClipboard(clip(`| Zone | Swabs H1 |\n| 1 | 4 |\n${SOURCE}`));
  assert.notEqual(pipes.data.kind, "table");

  const block = {
    id: "t1",
    type: "table",
    rows: 2,
    cols: 2,
    cells: [
      { r: 0, c: 0, text: "Zone", header: true },
      { r: 0, c: 1, text: "Swabs H1", header: true },
      { r: 1, c: 0, text: "1" },
      { r: 1, c: 1, text: "4" },
    ],
  };
  const menu = copyMenuPlan({
    id: "source",
    block,
    doc: { blocks: { t1: block }, order: ["t1"] },
    markdown: "| Zone | Swabs H1 |\n| --- | --- |\n| 1 | 4 |",
    source: "pinuid01",
  });
  assert.match(menu.text, /\| Zone \| Swabs H1 \|/);
  assert.doesNotMatch(menu.text, /pxd-size::/);
  const fromMenu = parseClipboard(clip(menu.text));
  assert.equal(fromMenu.data.kind, "table");
  assert.ok(fromMenu.data.table.cells.some((cell) => cell.text === "Swabs H1"));
  const board = src("../src/view/board-view.js");
  assert.match(board, /parseClipboard\(/);
  assert.match(board, /insertParsedTable\?\.\(\{/);
});

test("a ref-card Source loads the kept parse before it flashes", async () => {
  const doc = { blocks: { a: { id: "a", type: "para" } } };
  const found = await waitKeptParse(() => doc, { sleep: () => new Promise(() => {}) });
  assert.equal(found, doc);
  const started = Date.now();
  const missed = await waitKeptParse(() => new Promise(() => {}), { timeout: KEPT_PARSE_WAIT_MS, sleep: async () => null });
  assert.equal(missed, null);
  assert.ok(Date.now() - started < 500, "the bounded wait slept on the wall clock");
  assert.equal(await waitKeptParse(() => ({ pages: [] }), { sleep: () => new Promise(() => {}) }), null);

  const board = src("../src/view/board-view.js");
  const openAt = board.indexOf("function openPin");
  const open = board.slice(openAt, board.indexOf("openPinFromChip", openAt));
  assert.match(open, /pdfSourceOfItem\(/);
  assert.match(open, /waitKeptParse\(/);
  const pane = src("../src/view/read-pane.js");
  assert.match(pane, /showKeptParse\(doc/);
  assert.match(pane, /flashFrac\(frac, page\)/);
  const revealAt = board.indexOf("async function revealSidebarPin");
  const reveal = board.slice(revealAt, board.indexOf("function openPin", revealAt));
  assert.match(reveal, /loadParsedFor\(/);
});

test("the Source chip sits under the caption instead of over it", () => {
  const css = src("../src/css/source-chip.css");
  assert.match(css, /pxd-item__body:has\(> \.pxd-chip--source\)/);
  assert.match(css, /max-height:\s*360px/);
  const rule = css.slice(css.indexOf(".pxd-item__body > .pxd-chip.pxd-chip--source"));
  assert.doesNotMatch(rule, /margin-top:\s*auto/);
  assert.match(rule, /margin-top:\s*4px/);
  assert.match(rule, /position:\s*static/);
  assert.doesNotMatch(rule, /z-index/);
});
