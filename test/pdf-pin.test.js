// PDF source pins: grammar, dedupe, write counts, menus, clipboard, popover.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { parseClipboard } from "../src/model/clipboard.js";
import { pxdTarget } from "../src/model/deeplink.js";
import { handleParseDrop } from "../src/model/drop.js";
import {
  CARD_JSON_MIME,
  CAPTION_CAP,
  COPY_MENU,
  PIN_IOU,
  WITH_SOURCE_KEY,
  boardsFromRefs,
  cardJsonPayload,
  commitPinWrites,
  findDuplicatePin,
  fracStyle,
  gestureSource,
  pageFracFromBbox,
  parseCardJson,
  pasteCardPlan,
  pinCaption,
  pinClickMode,
  pinDeepLink,
  pinOpenPlan,
  pinPdfUrl,
  pinSpecFromBlock,
  pinWriteSteps,
  pinnedToast,
  planPinWrites,
  pxdPinTarget,
  readWithSource,
  rectIou,
  sourceAttrString,
  sourcePinOf,
  surroundingParagraph,
  writeWithSource,
} from "../src/model/pdf-pin.js";
import { isStructuralString, parseRegion, serializeRegion } from "../src/model/regions.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { chipPlan, createPageChips, runChipAction } from "../src/view/page-chips.js";
import { buildPinChip, mountPdfPin, openPinPopover } from "../src/view/pdf-pin-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";

afterEach(() => resetSessions());

const PIN_STRING = "{{[[plexus-pin]]: d=pdfblock1 pg=6 f=0.12,0.41,0.76,0.09}} Osmotic water flow";
const LEGACY_PIN = "{{[[plexus-region]]: k=pdf d=pdfblock1 pg=6 f=0.12,0.41,0.76,0.09}} Osmotic water flow";
const FRAC = [0.12, 0.41, 0.76, 0.09];

function memoryStorage() {
  const map = new Map();
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
  };
}

function sampleDoc() {
  return {
    sha256: "abc",
    engine: "builtin",
    optsHash: "h",
    pages: [{ n: 1, w: 200, h: 400, rotation: 0 }, { n: 6, w: 200, h: 400, rotation: 0 }],
    order: ["h1", "p1", "t0", "cap", "f1", "t1"],
    blocks: {
      h1: { id: "h1", type: "heading", page: 6, text: "Before", bbox: [0, 0, 80, 12] },
      p1: { id: "p1", type: "para", page: 6, text: "Osmotic water flow", bbox: [10, 20, 110, 40] },
      t0: { id: "t0", type: "table", page: 1, bbox: [0, 0, 10, 10], rows: 1, cols: 1 },
      cap: { id: "cap", type: "caption", page: 6, for: "f1", text: "Figure of the pore" },
      f1: { id: "f1", type: "figure", page: 6, bbox: [0, 50, 40, 90], caption: "cap" },
      t1: { id: "t1", type: "table", page: 6, bbox: [0, 100, 80, 140], rows: 51, cols: 11 },
    },
  };
}

test("a pin writes plexus-pin with pg then f, the old k=pdf form still reads, and a bad pin is unsupported", () => {
  const raw = serializeRegion({ kind: "pdf", drawingUid: "pdfblock1", pg: 6, f: FRAC, caption: "Osmotic water flow" });
  assert.equal(raw, PIN_STRING);
  const region = parseRegion(raw);
  assert.equal(region.kind, "pdf");
  assert.equal(region.drawingUid, "pdfblock1");
  assert.equal(region.pg, 6);
  assert.deepEqual(region.f, FRAC);
  assert.equal(region.caption, "Osmotic water flow");
  assert.equal(region.supported, true);
  assert.equal(region.owner, "plexus-diagram");
  assert.deepEqual(region.extra, []);
  assert.equal(isStructuralString(raw), true);
  assert.equal(parseRegion("{{[[plexus-region]]: k=pdf d=pdfblock1 f=0.1,0.2,0.3,0.4}} quote").supported, false);
  assert.equal(parseRegion("{{[[plexus-region]]: k=pdf d=pdfblock1 pg=0 f=0.1,0.2,0.3,0.4}} quote").supported, false);
  assert.equal(parseRegion("{{[[plexus-region]]: k=pdf d=pdfblock1 pg=6 f=0,0,0,0}} quote").supported, false);
  assert.equal(parseRegion("{{[[plexus-pin]]: d=pdfblock1 f=0.1,0.2,0.3,0.4}} quote").supported, false);
  assert.equal(parseRegion("{{[[plexus-pin]]: k=img d=pdfblock1 pg=2 f=0.1,0.2,0.3,0.4}} quote").supported, false);
  assert.equal(parseRegion("{{[[plexus-pin]]: k=pdf d=pdfblock1 pg=6 f=0.12,0.41,0.76,0.09}} Osmotic water flow").supported, true);
  const legacy = parseRegion(LEGACY_PIN);
  assert.equal(legacy.kind, "pdf");
  assert.equal(legacy.supported, true);
  assert.equal(legacy.pg, 6);
  assert.deepEqual(legacy.f, FRAC);
  assert.equal(legacy.macro, undefined);
  assert.equal(region.macro, "plexus-pin");
  assert.equal(serializeRegion(legacy), PIN_STRING);
  assert.equal(isStructuralString(LEGACY_PIN), true);
  assert.equal(pinOpenPlan({ ...legacy, uid: "old1" }).pinUid, "old1");
  assert.equal(raw.includes("plexus-region]"), false);
  assert.equal(raw.includes("k="), false);
  const img = "{{[[plexus-region]]: k=img d=draw1 f=0.1,0.2,0.3,0.4}} cap";
  assert.equal(serializeRegion(parseRegion(img)), img);
});

test("page fractions stay in 0..1 and captions follow the block kind", () => {
  const page = { n: 6, w: 200, h: 400, rotation: 0 };
  const frac = pageFracFromBbox([0, 0, 100, 50], page);
  assert.deepEqual(frac, [0, 0, 0.5, 0.125]);
  assert.equal(pageFracFromBbox(null, page), null);
  const doc = sampleDoc();
  assert.equal(pinCaption(doc.blocks.p1, doc), "Osmotic water flow");
  assert.equal(pinCaption({ id: "long", type: "para", text: "a".repeat(CAPTION_CAP + 20) }, doc).length, CAPTION_CAP);
  assert.equal(pinCaption(doc.blocks.t1, doc), "Table 2 · 51×11, p. 6");
  assert.equal(pinCaption(doc.blocks.f1, doc), "Figure of the pore");
  const spec = pinSpecFromBlock(doc.blocks.p1, doc, "pdfblock1");
  assert.equal(spec.pdfUid, "pdfblock1");
  assert.equal(spec.page, 6);
  assert.equal(spec.frac.length, 4);
  assert.ok(spec.frac.every((n) => n >= 0 && n <= 1));
  assert.equal(surroundingParagraph(doc, doc.blocks.p1), "Before Osmotic water flow");
});

test("dedupe reuses the same page at IoU 0.9 and ignores a pin with no uid", () => {
  const regions = [{ kind: "pdf", pg: 6, f: FRAC, uid: "pin1" }, { kind: "pdf", pg: 6, f: [0.9, 0.9, 0.05, 0.05] }];
  assert.equal(findDuplicatePin(regions, { page: 6, frac: FRAC }, PIN_IOU).uid, "pin1");
  assert.ok(Math.abs(rectIou(FRAC, FRAC) - 1) < 1e-9);
  assert.equal(findDuplicatePin(regions, { page: 6, frac: [0.9, 0.9, 0.05, 0.05] }), null);
  assert.equal(findDuplicatePin(regions, { page: 7, frac: FRAC }), null);
  const planned = planPinWrites({ pdfUid: "pdfblock1", page: 6, frac: FRAC, caption: "Osmotic water flow", regions, containerUid: "box1", pinUid: "new" });
  assert.equal(planned.reused, true);
  assert.equal(planned.uid, "pin1");
  assert.deepEqual(planned.creates, []);
});

test("design write steps stay at 5, and props counts the real card update", () => {
  assert.deepEqual(pinWriteSteps({ card: true, table: true, attr: true, containerExists: false }), {
    steps: ["card", "table", "container", "pin", "attr"],
    writes: 5,
    oneTransaction: true,
  });
  assert.deepEqual(pinWriteSteps({ card: true, attr: true, containerExists: true, props: true }), {
    steps: ["card", "props", "pin", "attr"],
    writes: 4,
    oneTransaction: true,
  });
  assert.equal(pinWriteSteps({ card: true, attr: true, containerExists: false, props: true }).writes, 5);
  assert.equal(pinWriteSteps({ containerExists: true, reused: true, attr: true }).writes, 1);
  assert.equal(pinWriteSteps({ containerExists: false }).writes, 2);
  assert.equal(pinWriteSteps({ reused: true }).writes, 0);
});

test("commitPinWrites creates the container and pin once, then reuses them", () => {
  const made = [];
  let n = 0;
  const io = {
    generateUid: () => `gen${++n}`,
    createBlock(spec) {
      const uid = spec.uid || `made${++n}`;
      made.push({ ...spec, uid });
      return uid;
    },
  };
  const spec = { pdfUid: "pdf1", page: 6, frac: [0.1, 0.2, 0.3, 0.1], caption: "Osmotic water flow", regions: [] };
  const first = commitPinWrites(io, spec);
  assert.equal(first.writes, 2);
  assert.equal(first.reused, false);
  assert.deepEqual(first.steps, ["container", "pin"]);
  assert.equal(first.outside, 0);
  assert.equal(made[0].string, "{{[[plexus-pins]]}}");
  assert.equal(made[1].string.startsWith("{{[[plexus-pin]]: d=pdf1 pg=6 "), true);
  assert.equal(made[0].open, false);
  assert.deepEqual(made[0].props, { plexus: { type: "regions" } });
  const region = parseRegion(made[1].string);
  assert.equal(region.supported, true);
  assert.equal(region.pg, 6);
  region.uid = first.uid;
  const again = commitPinWrites(io, { ...spec, regions: [region], containerUid: made[0].uid });
  assert.equal(again.reused, true);
  assert.equal(again.writes, 0);
  assert.equal(again.uid, first.uid);
  assert.equal(made.length, 2);
  assert.throws(() => planPinWrites({ pdfUid: "pdf1", page: 0, frac: [0, 0, 0, 0], regions: [] }), TypeError);
});

function setup() {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({
    uid: "b1",
    props: { plexus: { v: 2 } },
    children: [{ uid: "c1", string: "note", props: { plexus: { x: 0, y: 0, w: 280, h: 160 } } }],
  });
  fake.seedPage({
    uid: "page1",
    title: "Lab",
    children: [{ uid: "pdf1", string: "{{[[pdf]]: http://x/y.pdf}}" }],
  });
  const session = acquireSession("b1", { host, linkDelay: 0 });
  return { fake, host, session };
}

const pin = { pdfUid: "pdf1", page: 6, frac: [0.1, 0.2, 0.3, 0.1], caption: "Osmotic water flow" };

function containerOf(fake) {
  const uid = fake.children("pdf1").find((id) => String(fake.block(id).string) === "{{[[plexus-pins]]}}");
  return uid ? fake.block(uid) : null;
}

test("a card with a new pin is 5 writes in one undo, and the next cite reuses it", async () => {
  const { fake, host, session } = setup();
  const first = await session.insertParsedCard({ x: 20, y: 24, markdown: "- Osmotic water flow", pin });
  assert.equal(first.ok, true);
  assert.equal(first.writes, 5);
  assert.equal(host.stats.lastAction.writes, 5);
  const box = containerOf(fake);
  assert.ok(box);
  assert.equal(box.open, false);
  assert.equal(fake.props(box.uid).plexus.type, "regions");
  const pinUid = fake.children(box.uid)[0];
  const region = parseRegion(fake.block(pinUid).string);
  assert.equal(region.pg, 6);
  assert.equal(region.caption, "Osmotic water flow");
  assert.equal(sourcePinOf(host.pullTree(first.uid, 1, 20)).uid, pinUid);
  assert.equal(JSON.stringify(fake.block(pinUid)).includes(":diagram"), false);
  assert.equal(JSON.stringify(fake.props(box.uid)).includes("BT_attr"), false);

  const second = await session.insertParsedCard({ x: 400, y: 24, markdown: "- Again", pin });
  assert.equal(second.writes, 3);
  assert.equal(fake.children(box.uid).length, 1);
  assert.equal(sourcePinOf(host.pullTree(second.uid, 1, 20)).uid, pinUid);

  const reused = await session.ensurePdfPin(pin);
  assert.equal(reused.ok, true);
  assert.equal(reused.reused, true);
  assert.equal(reused.uid, pinUid);
  assert.equal(reused.writes, 0);
  assert.equal(host.stats.lastAction.writes, 3);

  const fresh = await session.ensurePdfPin({ ...pin, page: 7, frac: [0.5, 0.5, 0.2, 0.1], caption: "Later" });
  assert.equal(fresh.reused, false);
  assert.equal(fresh.writes, 1);
  assert.equal(fake.children(box.uid).length, 2);
});

test("the first pin card undoes as one group", async () => {
  const { fake, session } = setup();
  const res = await session.insertParsedCard({ x: 20, y: 24, markdown: "- Osmotic water flow", pin });
  assert.equal(res.writes, 5);
  fake.calls.length = 0;
  await session.undo();
  assert.equal(fake.calls.filter((row) => row[0] === "undo").length, 5);
  assert.equal(fake.has(res.uid), false);
});

test("pasting a card that already names a pin writes only the Source attribute", async () => {
  const { fake, session } = setup();
  const made = await session.ensurePdfPin(pin);
  assert.ok(made.writes <= 2);
  const res = await session.insertParsedCard({
    x: 20, y: 24, markdown: "- Osmotic water flow", sourceUid: made.uid,
  });
  assert.equal(res.writes, 3);
  assert.equal(sourcePinOf([{ string: fake.block(fake.children(res.uid)[0]).string }]).uid, made.uid);
  assert.equal(fake.children(containerOf(fake).uid).length, 1);
});

test("an old k=pdf pin under plexus-regions still dedupes, and a new pin goes under plexus-pins", async () => {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({ uid: "b1", props: { plexus: { v: 2 } }, children: [] });
  fake.seedPage({
    uid: "page1",
    title: "Lab",
    children: [{
      uid: "pdf1",
      string: "{{[[pdf]]: http://x/y.pdf}}",
      children: [{
        uid: "oldbox",
        string: "{{[[plexus-regions]]}}",
        open: false,
        children: [{ uid: "oldpin", string: "{{[[plexus-region]]: k=pdf d=pdf1 pg=6 f=0.1,0.2,0.3,0.1}} Osmotic water flow" }],
      }],
    }],
  });
  const session = acquireSession("b1", { host, linkDelay: 0 });
  const same = await session.ensurePdfPin(pin);
  assert.equal(same.reused, true);
  assert.equal(same.uid, "oldpin");
  assert.equal(same.writes, 0);
  const fresh = await session.ensurePdfPin({ ...pin, page: 7, frac: [0.5, 0.5, 0.2, 0.1], caption: "Later" });
  assert.equal(fresh.reused, false);
  assert.equal(fresh.writes, 2);
  const box = containerOf(fake);
  assert.ok(box);
  assert.notEqual(box.uid, "oldbox");
  assert.equal(fake.children("oldbox").length, 1);
  assert.deepEqual(fake.children(box.uid), [fresh.uid]);
  assert.equal(fake.block(fresh.uid).string, "{{[[plexus-pin]]: d=pdf1 pg=7 f=0.5,0.5,0.2,0.1}} Later");
});

test("clipboard card JSON and the pin link keep their own MIME and query key", () => {
  const body = cardJsonPayload({ markdown: "- Hi", size: { w: 320, h: 180 }, kind: "para", source: "pinuid01" });
  assert.deepEqual(body, { markdown: "- Hi", size: { w: 320, h: 180 }, kind: "para", source: "pinuid01" });
  assert.equal(cardJsonPayload({ markdown: "- Hi", source: "bad uid" }).source, undefined);
  assert.equal(parseCardJson("{"), null);
  const parsed = parseClipboard({
    getData(type) { return type === CARD_JSON_MIME ? JSON.stringify(body) : ""; },
    files: [],
  });
  assert.equal(parsed.kind, "card-json");
  assert.deepEqual(parsed.data, body);
  assert.deepEqual(pasteCardPlan(parsed.data, { x: 12, y: 34 }), {
    x: 12, y: 34, w: 320, h: 180, markdown: "- Hi", sourceUid: "pinuid01",
  });
  const hash = pinDeepLink({ graph: "Readwisenotes", pageUid: "page1", pinUid: "pinuid01" });
  assert.equal(hash, "#/app/Readwisenotes/page/page1?pxd-pin=pinuid01");
  assert.deepEqual(pxdPinTarget(hash), { pinUid: "pinuid01", pageUid: "page1", graph: "Readwisenotes" });
  assert.equal(pxdTarget(hash), null);
  assert.equal(pxdPinTarget("#/app/Readwisenotes/page/page1?pxd=card1"), null);
  assert.equal(sourceAttrString("pinuid01"), "Source:: ((pinuid01))");
  assert.equal(sourceAttrString("bad uid"), "");
  assert.equal(pinnedToast(6), "Pinned p. 6");
  assert.equal(pinClickMode({ shiftKey: true, metaKey: true }), "sidebar");
  assert.equal(pinClickMode({ metaKey: true }), "main");
  assert.equal(pinClickMode({}), "popover");
  assert.deepEqual(fracStyle([0.1, 0.2, 0.3, 0.4]), { left: "10%", top: "20%", width: "30%", height: "40%" });
  assert.deepEqual(boardsFromRefs([["b1", "{{[[diagram]]}}"], ["b2", "a note"], { uid: "b1", string: "{{diagram}}" }]), [
    { uid: "b1", string: "{{[[diagram]]}}" },
  ]);
  assert.equal(pinPdfUrl("https://x/a.enc"), "");
  assert.equal(pinPdfUrl("https://x/a.enc?dl=1"), "");
  assert.equal(pinPdfUrl("https://x/a.pdf"), "https://x/a.pdf");
  assert.equal(pinOpenPlan(parseRegion(PIN_STRING)).pinUid, "");
  const open = parseRegion(PIN_STRING);
  open.uid = "pinuid01";
  assert.deepEqual(pinOpenPlan(open), { pdfUid: "pdfblock1", page: 6, frac: FRAC, pinUid: "pinuid01" });
});

test("a text drop never pins, and a block drop pins only when withSource is set", async () => {
  const doc = sampleDoc();
  const seen = [];
  const session = {
    footnoteFormat: () => "off",
    insertParsedCard: async (arg) => { seen.push(arg); return { ok: true, uid: "card1" }; },
  };
  const store = { getParse: async () => doc };
  await handleParseDrop({
    payload: { kind: "text", text: "Hello", page: 6, pdfUid: "cardpdf", withSource: true },
    session,
    point: { x: 1, y: 2 },
  });
  assert.equal(seen[0].pin, undefined);
  await handleParseDrop({
    payload: { kind: "blocks", ids: ["p1"], sha256: "abc", engine: "builtin", optsHash: "h", pdfUid: "cardpdf", pdfBlockUid: "pdfblock1" },
    store, session, point: { x: 3, y: 4 },
  });
  assert.equal(seen[1].pin, undefined);
  await handleParseDrop({
    payload: { kind: "blocks", ids: ["p1"], sha256: "abc", engine: "builtin", optsHash: "h", pdfUid: "cardpdf", pdfBlockUid: "pdfblock1", withSource: true },
    store, session, point: { x: 5, y: 6 },
  });
  assert.equal(seen[2].pin.pdfUid, "pdfblock1");
  assert.equal(seen[2].pin.page, 6);
  assert.equal(seen[2].pin.caption, "Osmotic water flow");
});

test("chip menus add With source and Copy ref, and the checkbox does not insert", () => {
  const doc = sampleDoc();
  assert.deepEqual(chipPlan(doc.blocks.t1, doc).menu.map((row) => row.label).slice(-2), ["With source", "Copy ref to source"]);
  assert.deepEqual(chipPlan(doc.blocks.h1, doc).menu.map((row) => row.label).slice(-2), ["With source", "Copy ref to source"]);
  assert.deepEqual(chipPlan(doc.blocks.f1, doc).menu.map((row) => row.label).slice(-2), ["With source", "Copy ref to source"]);
  const list = { id: "l1", type: "list", page: 6, bbox: [0, 0, 10, 10] };
  assert.deepEqual(chipPlan(list, { ...doc, blocks: { ...doc.blocks, l1: list } }).menu.map((row) => row.label), ["With source", "Copy ref to source"]);
  assert.deepEqual(COPY_MENU.map((row) => row.id), ["copy", "plain", "card", "source", "crop", "link"]);
  assert.deepEqual(COPY_MENU.map((row) => row.label), ["Copy", "Copy as plain text", "Copy as card", "Copy with source", "Copy crop as image", "Copy link"]);
  assert.equal(runChipAction({ act: "with-source" }, {}), false);
  assert.equal(runChipAction({ act: "pin-ref" }, {}), false);
  const seen = [];
  runChipAction({ act: "card", ids: ["p1"], withSource: true }, { session: { insertParsedCard: (arg) => seen.push(arg) }, payload: (ids) => ({ ids }) });
  assert.equal(seen[0].withSource, true);
  runChipAction({ act: "card", ids: ["p1"] }, { session: { insertParsedCard: (arg) => seen.push(arg) }, payload: (ids) => ({ ids }) });
  assert.equal(seen[1].withSource, undefined);

  const storage = memoryStorage();
  assert.equal(readWithSource(storage), false);
  assert.equal(gestureSource(readWithSource(storage), true), true);
  writeWithSource(storage, true);
  assert.equal(storage.getItem(WITH_SOURCE_KEY), "1");
  assert.equal(gestureSource(readWithSource(storage), true), false);
  assert.equal(gestureSource(readWithSource(storage), false), true);

  const stub = createDomStub();
  const restore = stub.install();
  try {
    const page = globalThis.document.createElement("div");
    page.className = "page";
    page.setAttribute("data-page-number", "6");
    globalThis.document.body.append(page);
    const calls = [];
    const chips = createPageChips({
      doc: globalThis.document,
      getParsed: () => doc,
      pageEl: (n) => (n === 6 ? page : null),
      pageOf: () => ({ w: 200, h: 400, rotation: 0 }),
      storage,
      run: (act, item) => calls.push({ act, withSource: item.withSource }),
    });
    stub.dispatch(page, "pointermove", { clientX: 40, clientY: 120 });
    const chip = page.querySelector(".pxd-page-chip");
    chip.querySelector(".pxd-page-chip__more").click();
    const box = [...chip.querySelectorAll(".pxd-page-chip__item")].find((node) => node.getAttribute("data-act") === "with-source");
    assert.equal(box.getAttribute("role"), "menuitemcheckbox");
    box.click();
    assert.equal(calls.length, 0);
    assert.equal(storage.getItem(WITH_SOURCE_KEY), "0");
    assert.equal(chip.querySelector(".pxd-page-chip__menu").hidden, false);
    stub.dispatch(chip.querySelector(".pxd-page-chip__main"), "click", { altKey: true });
    assert.equal(calls[0].withSource, true);
    chips.dispose();
  } finally { restore(); }
});

test("the pin popover quotes the caption and loads a crop only after it is on screen", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  const previous = globalThis.IntersectionObserver;
  const loads = [];
  class FakeIO {
    constructor(cb) { this.cb = cb; FakeIO.last = this; }
    observe() {}
    disconnect() { this.dead = true; }
  }
  globalThis.IntersectionObserver = FakeIO;
  try {
    const doc = globalThis.document;
    const region = parseRegion(PIN_STRING);
    region.uid = "pinuid01";
    region.url = "https://x/a.enc";
    const host = doc.createElement("div");
    const button = doc.createElement("button");
    button.className = "rm-xparser-default-plexus-region";
    host.append(button);
    doc.body.append(host);
    const opened = [];
    const copied = [];
    const handle = mountPdfPin({
      doc,
      button,
      region,
      loadCrop: (ask) => { loads.push(ask); return "data:image/png;base64,aa"; },
      boardsOf: async () => [{ uid: "b1", title: "Lab board" }],
      writeText: (text) => copied.push(text),
      onOpen: (info) => opened.push(info.mode),
      surrounding: "Before Osmotic water flow",
      root: doc.body,
    });
    assert.equal(loads.length, 0);
    assert.equal(handle.loads(), 0);
    assert.equal(button.style.display, "none");
    assert.equal(handle.el.querySelector(".pxd-pdf-pin__quote").textContent, "Osmotic water flow");
    assert.equal(handle.el.querySelector(".pxd-pdf-pin__page").textContent, "p. 6");
    handle.el.dispatchEvent({ type: "mouseenter" });
    assert.equal(doc.querySelector(".pxd-pin-pop"), null);
    FakeIO.last.cb([{ isIntersecting: true }]);
    assert.equal(loads.length, 0, "an .enc URL never asks for a crop");
    handle.el.click();
    await Promise.resolve();
    await Promise.resolve();
    const pop = doc.querySelector(".pxd-pin-pop");
    assert.ok(pop);
    assert.equal(pop.querySelector(".pxd-pin-pop__quote").textContent, "Osmotic water flow");
    assert.equal(pop.querySelector(".pxd-pin-pop__around").textContent, "Before Osmotic water flow");
    assert.equal(pop.querySelector(".pxd-pdf-pin__page").textContent, "p. 6");
    const labels = [...pop.querySelectorAll("button")].map((node) => node.textContent);
    assert.deepEqual(labels, ["Open in reader", "Sidebar", "Boards", "Copy ref"]);
    labels[0] = null;
    pop.querySelectorAll("button")[0].click();
    assert.deepEqual(opened, ["main"]);
    pop.querySelectorAll("button")[2].click();
    assert.equal(pop.querySelector(".pxd-pin-pop__board").textContent, "Lab board");
    pop.querySelector(".pxd-pin-pop__board").click();
    assert.deepEqual(opened, ["main", "board"]);
    pop.querySelectorAll("button")[3].click();
    assert.deepEqual(copied, ["((pinuid01))"]);
    handle.destroy();
    assert.equal(button.style.display, "");
    assert.equal(FakeIO.last.dead, true);

    const bare = openPinPopover({ doc, region, boards: [] });
    bare.el.querySelectorAll("button")[2].click();
    assert.equal(bare.el.textContent.includes("No boards"), true);
    bare.close();
    const chip = buildPinChip(doc, { pinUid: "pinuid01" }, (uid) => opened.push(uid));
    assert.equal(chip.className, "pxd-chip pxd-chip--source");
    chip.click();
    assert.equal(opened.at(-1), "pinuid01");

    const live = { ...region, url: "https://x/a.pdf" };
    const button2 = doc.createElement("button");
    host.append(button2);
    const shown = mountPdfPin({
      doc, button: button2, region: live, root: doc.body,
      loadCrop: (ask) => { loads.push(ask.url); return ""; },
    });
    assert.equal(loads.length, 0);
    FakeIO.last.cb([{ isIntersecting: false }]);
    assert.equal(loads.length, 0);
    FakeIO.last.cb([{ isIntersecting: true }]);
    FakeIO.last.cb([{ isIntersecting: true }]);
    assert.deepEqual(loads, ["https://x/a.pdf"]);
    shown.destroy();
  } finally {
    if (previous) globalThis.IntersectionObserver = previous;
    else delete globalThis.IntersectionObserver;
    restore();
  }
});

test("loading the pin modules does not call pdf.js", () => {
  const feature = readFileSync(new URL("../src/feature.js", import.meta.url), "utf8");
  const at = feature.indexOf("async function loadPinCrop");
  assert.ok(at > 0);
  assert.equal(feature.slice(0, at).includes("getDocument"), false);
  const pdfAt = feature.indexOf('if (region.kind === "pdf")');
  const imgAt = feature.indexOf('if (region.kind !== "img" && region.kind !== "view")');
  assert.ok(pdfAt > 0 && pdfAt < imgAt);
  assert.match(feature.slice(pdfAt, imgAt), /regionsInline\] === false/);
  assert.equal(pinPdfUrl(""), "");
});
