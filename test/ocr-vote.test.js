// Vision/PP-OCR word vote and the page-consensus spelling it shares with the helpers.
import assert from "node:assert/strict";
import test from "node:test";

import { joinLines } from "../src/model/parse/blocks.js";
import { assembleDocument, parsePageGeometry } from "../src/model/parse/index.js";
import { chooseReading, preferSpellings, voteOcrBodies, votingHelper } from "../src/model/parse/ocr-vote.js";
import { readScan } from "../src/view/parse-engine.js";

const lexicon = new Set(["pressure", "form", "from", "the", "rose", "compressed", "flow"]);

function word(str, x, y = 200, width = null) {
  return {
    str,
    transform: [10, 0, 0, 10, x, y],
    width: width ?? Math.max(18, str.length * 5),
    height: 10,
    y0: y - 8,
    y1: y + 2,
    fontName: "ocr",
    conf: 1,
  };
}

const tableRules = [
  { x0: 20, y0: 30, x1: 220, y1: 30, thick: 0.4 },
  { x0: 20, y0: 90, x1: 220, y1: 90, thick: 0.4 },
  { x0: 20, y0: 30, x1: 20, y1: 90, thick: 0.4 },
  { x0: 220, y0: 30, x1: 220, y1: 90, thick: 0.4 },
];

test("chooseReading keeps Vision numbers and takes a lexicon spelling", () => {
  assert.equal(chooseReading({ str: "1.53" }, { str: "l.53" }, lexicon), "1.53");
  assert.equal(chooseReading({ str: "1.53" }, { str: "fifteen" }, lexicon), "1.53");
  assert.equal(chooseReading({ str: "energy" }, { str: "39.87" }, lexicon), "39.87");
  assert.equal(chooseReading({ str: "prossure" }, { str: "pressure" }, lexicon), "pressure");
  assert.equal(chooseReading({ str: "form" }, { str: "xyzzy" }, lexicon), "form");
  assert.equal(chooseReading({ str: "mine" }, { str: "wing" }, new Set(["mine", "wing"])), "wing");
  assert.equal(chooseReading({ str: "success." }, { str: "success-" }, new Set(["success"])), "success-");
  assert.equal(chooseReading({ str: "success-" }, { str: "success." }, new Set(["success"])), "success-");
  assert.equal(chooseReading({ str: "form." }, { str: "form" }, lexicon), "form.");
});

test("preferSpellings fixes a repeated one-edit miss and leaves lexicon words", () => {
  const items = [word("prossure", 40), word("pressure", 120), word("pressure", 200), word("form", 280), word("from", 340), word("from", 400)];
  const once = preferSpellings(items, lexicon);
  assert.deepEqual(once.map((item) => item.str), ["pressure", "pressure", "pressure", "form", "from", "from"]);
  const twice = preferSpellings(once, lexicon);
  assert.deepEqual(twice.map((item) => item.str), once.map((item) => item.str));
});

test("an unknown spelling that the page repeats replaces the one-edit miss", () => {
  const items = [word("suporcharger", 40), word("supercharger", 160), word("supercharger", 280), word("supercharger", 400)];
  const out = preferSpellings(items, lexicon);
  assert.equal(out[0].str, "supercharger");
});

test("voteOcrBodies keeps table text, inserts a missed lexicon word, and does not retag the page", () => {
  const vision = {
    n: 10, w: 612, h: 792, rules: tableRules,
    items: [word("0.D0", 80, 50, 24), word("the", 70), word("flow", 220)],
  };
  const other = {
    n: 10,
    items: [word("0.00", 80, 50, 24), word("the", 70), word("compressed", 120, 200, 55), word("flow", 220)],
  };
  const [page] = voteOcrBodies([vision], [other], lexicon);
  assert.equal(page.engine, undefined);
  assert.equal(page.items[0].str, "0.D0");
  assert.ok(page.items.some((item) => item.str === "compressed"));
  assert.equal(page.items[0].transform[4], 80);
});

test("a page-sized rule frame does not block the body vote", () => {
  const frame = [
    { x0: 8, y0: 8, x1: 600, y1: 8 },
    { x0: 8, y0: 780, x1: 600, y1: 780 },
    { x0: 8, y0: 8, x1: 8, y1: 780 },
    { x0: 600, y0: 8, x1: 600, y1: 780 },
  ];
  const [page] = voteOcrBodies(
    [{ n: 1, w: 612, h: 792, rules: frame, items: [word("prossure", 80)] }],
    [{ n: 1, items: [word("pressure", 80)] }],
    lexicon,
  );
  assert.equal(page.items[0].str, "pressure");
});

test("votingHelper votes pages and leaves cell re-reads on Vision", async () => {
  const calls = [];
  const helper = votingHelper({
    vision: {
      async ocr(req) {
        calls.push(req.cells ? "cells" : "pages");
        if (req.cells) return { cells: [{ text: "1.53" }] };
        return { pages: [{ n: 1, w: 612, h: 792, rules: [], items: [word("prossure", 80)] }] };
      },
    },
    alt: {
      async ocr() {
        calls.push("alt");
        return { pages: [{ n: 1, items: [word("pressure", 80)] }] };
      },
    },
    lexicon,
  });
  const body = await helper.ocr({ pages: [1] });
  assert.equal(body.pages[0].items[0].str, "pressure");
  assert.equal(body.pages[0].engine, undefined);
  const cells = await helper.ocr({ cells: [{ page: 1, bbox: [0, 0, 1, 1] }] });
  assert.equal(cells.cells[0].text, "1.53");
  assert.deepEqual(calls, ["pages", "alt", "cells"]);
});

test("readScan votes the alt reading and does not send cell re-reads to it", async () => {
  const scanRec = parsePageGeometry({ items: [], ops: { fnArray: [], argsArray: [] }, w: 612, h: 792, rotation: 0, fonts: {} }, 1);
  scanRec.kind = "scan";
  const base = assembleDocument([scanRec], { numPages: 1, from: 1, to: 1 });
  const page = { n: 1, w: 612, h: 792, rules: [], items: [word("the", 70), word("prossure", 120), word("rose", 230)] };
  const log = [];
  const helper = {
    async ocr({ cells }) {
      log.push(cells ? "cells" : "helper");
      if (cells) return { cells: [] };
      return { pages: [page] };
    },
  };
  const alt = {
    async ocr() {
      log.push("alt");
      return { pages: [{ n: 1, items: [word("the", 70), word("pressure", 120), word("rose", 230)] }] };
    },
  };
  const out = await readScan({
    helper, alt, lexicon, base, records: [scanRec], numPages: 1, from: 1, to: 1, lines: false,
  });
  const text = out.doc.order.map((id) => out.doc.blocks[id]?.text || "").join("\n");
  assert.match(text, /pressure/);
  assert.equal(text.includes("prossure"), false);
  assert.deepEqual(log, ["helper", "alt"]);
});

test("a short inserted word stays on the line baseline and keeps its space", () => {
  const missed = {
    str: "unnecessary",
    transform: [8, 0, 0, 8, 78, 204],
    width: 70,
    height: 8,
    y0: 198,
    y1: 206,
    fontName: "ocr",
    conf: 0.9,
  };
  const [page] = voteOcrBodies(
    [{ n: 1, w: 612, h: 792, rules: [], scan: true, items: [word("amount", 40), word("work", 156)] }],
    [{ n: 1, items: [missed] }],
    new Set(["unnecessary", "amount", "work"]),
  );
  const inserted = page.items.find((item) => item.str === "unnecessary");
  assert.equal(inserted.transform[0], 10);
  assert.equal(inserted.transform[5], 200);
  const geo = parsePageGeometry(page, 1);
  const line = geo.lines.find((row) => row.words.some((w) => w.text === "unnecessary"));
  assert.ok(line);
  assert.equal(line.words.find((w) => w.text === "unnecessary").sub, false);
  assert.equal(joinLines([line]).text.includes("amountunnecessary"), false);
  assert.match(joinLines([line]).text, /amount unnecessary work/);
});

test("a line-end hyphen matches a period on the same word even when the boxes barely overlap", () => {
  const vision = word("success.", 100, 118, 50);
  vision.y0 = 80;
  vision.y1 = 140;
  vision.height = 60;
  const other = word("success-", 100, 113, 50);
  other.transform = [10, 0, 0, 10, 100, 116];
  other.y0 = 108;
  other.y1 = 118;
  other.height = 10;
  const [page] = voteOcrBodies(
    [{ n: 1, w: 612, h: 792, rules: [], items: [vision, word("ive", 40, 140)] }],
    [{ n: 1, items: [other] }],
    new Set(["success", "ive"]),
  );
  assert.equal(page.items[0].str, "success-");
});
