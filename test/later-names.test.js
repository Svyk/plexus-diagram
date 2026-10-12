// WO N (Later list from the 3.26 hunt): PDF names N4, N5, N6.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { coverModel } from "../src/model/pdf.js";
import { createItemRenderer } from "../src/view/cards.js";
import { createPdfNames, IDENTS_KEY } from "../src/view/pdf-names.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const src = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const SELF = "{{[[pdf]]: https://example.test/spores_paper.pdf}}";
const REF = "{{[[pdf]]: https://example.test/ref_file.pdf}}";

function child(uid, string, order) {
  return { ":block/uid": uid, ":block/string": string, ":block/order": order, ":block/props": { ":plexus": { ":x": order * 320, ":y": 0, ":w": 240, ":h": 320 } }, ":block/children": [] };
}

test("N4: a PDF card takes its identity title when it lands later, and only that card repaints", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const itemsLayer = doc.createElement("div");
    const sectionsLayer = doc.createElement("div");
    doc.body.append(sectionsLayer, itemsLayer);
    const idleQueue = [];
    const idents = new Map();
    const covers = [];
    const r = createItemRenderer({
      doc,
      host: {
        renderString(node, string) { node.textContent = string; },
        renderBlock() {},
        unmount() {},
        blockString() { return ""; },
        pdfCover(string) { covers.push(string); return coverModel({ count: 0 }); },
        updateProps() {},
      },
      session: { updateProps() {}, setString() {} },
      itemsLayer,
      sectionsLayer,
      timers: { idle(fn) { idleQueue.push(fn); return () => {}; }, later() { return () => {}; } },
      onReadPane: () => {},
      pdfIdentTitle: (url) => idents.get(url) || "",
    });
    const board = buildBoard({ ":block/uid": "boardpdfu", ":block/string": "{{[[diagram]]:PDFs}}", ":block/props": { ":plexus": { ":v": 2 } }, ":block/children": [child("pdfself01", SELF, 0), child("pdfref001", REF, 1)] }, { resolve: () => "" });
    r.sync({ board, rects: worldRects(board), structural: true });
    r.setLod("detail", 1);
    r.scheduleContent({ visibleRect: { x: -400, y: -400, w: 4000, h: 2000 }, zoom: 1, tier: "detail" });
    for (let g = 0; idleQueue.length && g < 30; g += 1) idleQueue.shift()({ timeRemaining: () => 10 });
    const header = (uid) => r.shellOf(uid).querySelector(".pxd-item__header")?.textContent || "";
    const faceTitles = (uid) => [...r.shellOf(uid).querySelectorAll(".pxd-pdf-title")].map((n) => n.textContent);
    assert.doesNotMatch(header("pdfself01"), /Spore/);
    idents.set("https://example.test/spores_paper.pdf", "Spore heat resistance");
    covers.length = 0;
    r.repaintItems(["pdfself01"]);
    assert.equal(header("pdfself01"), "Spore heat resistance");
    for (const t of faceTitles("pdfself01")) assert.equal(t, "Spore heat resistance");
    assert.ok(covers.every((s) => s === SELF), "the other card was not repainted");
    r.dispose();
  } finally {
    restore();
  }
  // The board wires it: an identity landing repaints the PDF cards with that url, not the whole board.
  assert.match(src("view/board-view.js"), /landed\.has\(pdfMacroUrl\(pdfSourceOfItem\(it\)\)\)\) uids\.push\(it\.uid\);[\s\S]{0,80}itemsR\?\.repaintItems\?\.\(uids\)/);
});

function memStore() {
  const meta = new Map();
  return { meta, getMeta: async (k) => meta.get(k) ?? null, putMeta: async (k, v) => { meta.set(k, v); return true; } };
}
const idle = (fn) => { const id = setTimeout(fn, 0); return () => clearTimeout(id); };

test("N5: main and sidebar boards keep each other's identities in the shared record", async () => {
  const store = memStore();
  const make = () => createPdfNames({ store, lib: () => ({}), read: async (lib, url) => ({ title: `T ${url}` }), idle });
  const main = make();
  const side = make();
  await main.load();
  await side.load();
  await main.want(["a"]);
  await side.want(["b"]);
  for (let i = 0; i < 40 && !(main.get("a") && side.get("b")); i += 1) await tick(5);
  await tick(20);
  const items = store.meta.get(IDENTS_KEY)?.items || {};
  assert.equal(items.a?.title, "T a");
  assert.equal(items.b?.title, "T b");
  main.dispose();
  side.dispose();
});

test("N6: an empty PDF name answer is not cached; the next ask resolves it again", () => {
  assert.match(src("view/board-view.js"), /if \(info\.ownTitle \|\| info\.pdfPageTitle\) pdfNameInfo\.set\(infoKey, info\);/);
});
