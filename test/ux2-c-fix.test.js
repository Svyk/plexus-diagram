// Lane C fix round. A word-sized pin lands on the parsed part that contains it.
// A sidebar jump waits for the pin's own PDF.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

import { createHost } from "../src/host/roam.js";
import { matchParsedBlock, pageFracFromBbox } from "../src/model/pdf-pin.js";
import { acquireSession } from "../src/session.js";
import { createSettingsPanel } from "../src/settings.js";
import { applyPdfReaderDark } from "../src/view/pdf-reader-dark.js";
import { jumpSidebarPdf, pdfTargetsMatch, waitForSidebarPdf, watchNodeGone } from "../src/view/pin-reveal.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";

function figureDoc() {
  const page = { n: 3, w: 100, h: 200, rotation: 0 };
  const figure = { id: "f1", type: "figure", page: 3, bbox: [10, 20, 60, 80] };
  const text = { id: "p1", type: "para", page: 3, bbox: [10, 90, 90, 120], text: "Osmotic water flow" };
  const section = { id: "s1", type: "section", page: 3, bbox: [0, 70, 100, 150] };
  const table = { id: "t1", type: "table", page: 3, bbox: [10, 130, 90, 180] };
  return {
    page,
    figure,
    text,
    doc: { blocks: { f1: figure, s1: section, p1: text, t1: table }, order: ["s1", "f1", "p1", "t1"], pages: [page] },
  };
}

test("a word-sized hit matches the tightest block that holds its centre", () => {
  const { doc, page, text } = figureDoc();
  const para = pageFracFromBbox(text.bbox, page);
  const word = [para[0] + 0.2, para[1] + 0.04, 0.08, 0.03];
  assert.equal(matchParsedBlock(doc, { page: 3, frac: word }).id, "p1");
  assert.equal(matchParsedBlock(doc, { page: 3, frac: [0.01, 0.01, 0.04, 0.02] }), null);
  const speck = [0.2, 0.2, 0.05, 0.04];
  assert.equal(matchParsedBlock(doc, { page: 3, frac: speck }).id, "f1");
});

test("a similar box still wins on IoU, and a mostly covered smaller block still matches", () => {
  const { doc, page, text } = figureDoc();
  const para = pageFracFromBbox(text.bbox, page);
  const formula = { id: "q0", type: "formula", page: 3, bbox: [46, 100, 54, 110] };
  const nested = {
    ...doc,
    blocks: { ...doc.blocks, q0: formula },
    order: [...doc.order, "q0"],
  };
  const near = [para[0] + 0.02, para[1] + 0.01, para[2] - 0.04, para[3] - 0.02];
  assert.equal(matchParsedBlock(nested, { page: 3, frac: near }).id, "p1");
  const small = { id: "q1", type: "formula", page: 4, bbox: [30, 30, 42, 42] };
  const page4 = { n: 4, w: 100, h: 100, rotation: 0 };
  const quiet = {
    blocks: { ...doc.blocks, q1: small, corner: { id: "corner", type: "para", page: 4, bbox: [2, 2, 8, 8] } },
    order: [...doc.order, "q1", "corner"],
    pages: [...doc.pages, page4],
  };
  // Hit is larger than the formula, covers most of it, and its centre sits outside the formula.
  assert.equal(matchParsedBlock(quiet, { page: 4, frac: [0.18, 0.30, 0.20, 0.12] }).id, "q1");
  assert.equal(matchParsedBlock(quiet, { page: 4, frac: [0, 0, 1, 1] }), null);
});

function sidebarWindow(doc, uid, page, url) {
  const win = doc.createElement("div");
  win.className = "rm-sidebar-window";
  win.id = uid ? `sidebar-window-sidebar-block-${uid}` : "sidebar-window-notes";
  const box = doc.createElement("div");
  box.className = "rm-pdf-container";
  if (url) box.setAttribute("data-pdf-url", url);
  const input = doc.createElement("input");
  input.value = page;
  box.append(input);
  win.append(box);
  return { win, box, input };
}

test("a sidebar jump waits for the pin's PDF and leaves a different one alone", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = globalThis.document;
    const side = doc.createElement("div");
    side.id = "right-sidebar";
    const wrong = sidebarWindow(doc, "otherpdf1", "2");
    side.append(wrong.win);
    doc.body.append(side);
    const strings = {
      pinpdf01: "{{pdf: https://files.test/pin.pdf}}",
      otherpdf1: "{{pdf: https://files.test/other.pdf}}",
    };
    const readString = (uid) => strings[uid] || "";
    const want = { uid: "pinpdf01", url: "https://files.test/pin.pdf" };
    assert.equal(pdfTargetsMatch({ uid: "otherpdf1", url: strings.otherpdf1 }, want), false);
    assert.equal(jumpSidebarPdf(doc, 4, want, readString), false);
    assert.equal(wrong.input.value, "2");

    let now = 0;
    let sleeps = 0;
    let appeared = null;
    const found = await waitForSidebarPdf({
      doc,
      want,
      readString,
      timeout: 5000,
      step: 50,
      now: () => now,
      sleep: async (ms) => {
        sleeps += 1;
        if (sleeps > 200) throw new Error("sidebar wait did not stop");
        now += ms;
        if (sleeps === 2) {
          appeared = sidebarWindow(doc, "pinpdf01", "1");
          side.append(appeared.win);
        }
      },
    });
    assert.equal(found, appeared.box);
    assert.equal(sleeps, 2);
    assert.equal(jumpSidebarPdf(doc, 7, want, readString), true);
    assert.equal(appeared.input.value, "7");
    assert.equal(wrong.input.value, "2");

    let gone = 0;
    const stop = watchNodeGone(appeared.box, doc, () => { gone += 1; });
    appeared.win.remove();
    stub.flushMutations();
    assert.equal(gone, 1);
    doc.body.append(doc.createElement("div"));
    stub.flushMutations();
    assert.equal(gone, 1);
    stop();

    const late = sidebarWindow(doc, "", "3", "https://files.test/pin.pdf");
    const otherSide = doc.createElement("div");
    otherSide.className = "rm-right-sidebar";
    otherSide.append(late.win);
    doc.body.append(otherSide);
    assert.equal(jumpSidebarPdf(doc, 9, { url: "https://files.test/pin.pdf" }, readString), true);
    assert.equal(late.input.value, "9");
    assert.equal(wrong.input.value, "2");

    const stranger = sidebarWindow(doc, "", "5");
    otherSide.append(stranger.win);
    assert.equal(jumpSidebarPdf(doc, 6, { uid: "missingpdf" }, readString), false);
    assert.equal(stranger.input.value, "5");

    const held = sidebarWindow(doc, "heldpdf01", "1");
    side.append(held.win);
    let heldGone = 0;
    const unwatch = watchNodeGone(held.box, doc, () => { heldGone += 1; });
    unwatch();
    held.win.remove();
    stub.flushMutations();
    assert.equal(heldGone, 0);
  } finally {
    restore();
  }
});

test("a sidebar PDF that is already open is jumped without waiting", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = globalThis.document;
    const side = doc.createElement("div");
    side.id = "right-sidebar";
    const ready = sidebarWindow(doc, "pinpdf01", "3");
    side.append(ready.win);
    doc.body.append(side);
    let sleeps = 0;
    const found = await waitForSidebarPdf({
      doc,
      want: { uid: "pinpdf01" },
      timeout: 5000,
      now: () => 0,
      sleep: async () => { sleeps += 1; },
    });
    assert.equal(found, ready.box);
    assert.equal(sleeps, 0);
    let now = 0;
    const missed = await waitForSidebarPdf({
      doc,
      want: { uid: "notyetpdf" },
      timeout: 5000,
      step: 1000,
      now: () => now,
      sleep: async (ms) => {
        sleeps += 1;
        if (sleeps > 20) throw new Error("sidebar wait did not stop");
        now += ms;
      },
    });
    assert.equal(missed, null);
    const board = readFileSync(new URL("../src/view/board-view.js", import.meta.url), "utf8");
    assert.match(board, /waitForSidebarPdf\(/);
    assert.match(board, /watchNodeGone\(/);
    assert.match(board, /sourceUrl\?\.\(\)/);
    const pane = readFileSync(new URL("../src/view/read-pane.js", import.meta.url), "utf8");
    assert.match(pane, /sourceUrl:\s*\(\)\s*=>/);
    assert.match(pane, /blockUid:\s*\(\)\s*=>/);
  } finally {
    restore();
  }
});

function pinSetup() {
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

const figurePin = { pdfUid: "pdf1", page: 6, frac: [0.1, 0.2, 0.3, 0.1], caption: "Osmotic water flow" };

function pinsOf(fake) {
  const uid = fake.children("pdf1").find((id) => String(fake.block(id)?.string) === "{{[[plexus-pins]]}}");
  return uid ? fake.block(uid) : null;
}

test("a figure copy undoes the upload and the pin together", async () => {
  const { fake, session } = pinSetup();
  const deleted = [];
  const uploads = [];
  fake.setUpload(async ({ file }) => {
    uploads.push(file?.name || "file");
    return `https://files.test/${uploads.length}.png`;
  });
  fake.setFileDelete(async ({ url }) => { deleted.push(url); });
  const card = await session.insertParsedCard({ x: 10, y: 10, markdown: "- stay" });
  const made = await session.copyFigureFile({ spec: figurePin, file: { name: "fig.png", type: "image/png" } });
  assert.equal(made.ok, true);
  assert.equal(made.url, "https://files.test/1.png");
  assert.ok(made.uid);
  assert.ok(pinsOf(fake));
  await session.undo();
  assert.deepEqual(deleted, ["https://files.test/1.png"]);
  assert.equal(pinsOf(fake), null);
  assert.equal(fake.has(card.uid), true);
  assert.equal(fake.calls.filter((row) => row[0] === "undo").length, 0);
  await session.redo();
  assert.ok(pinsOf(fake));
  assert.equal(uploads.length, 2);

  const again = await session.copyFigureFile({ spec: figurePin, file: { name: "fig.png", type: "image/png" } });
  assert.equal(again.reused, true);
  assert.equal(again.uid, made.uid);
  const before = deleted.length;
  await session.undo();
  assert.equal(deleted.length, before + 1);
  assert.equal(fake.has(made.uid), true);

  deleted.length = 0;
  const missed = await session.copyFigureFile({ spec: { pdfUid: "pdf1" }, file: { name: "fig.png", type: "image/png" } });
  assert.equal(missed.ok, false);
  assert.ok(deleted.includes(missed.url) || deleted.length >= 1);
  await session.undo();
  assert.equal(fake.has(card.uid), true);
  const menu = readFileSync(new URL("../src/view/parse-view.js", import.meta.url), "utf8");
  assert.match(menu, /copyFigureFile\(/);
  assert.match(menu, /figureCardMarkdown\(live, parsed\)/);
});

test("PDF dark mode leaves the board reader alone and paints page photos back", async () => {
  const { photoFracs, shouldRestoreContainer } = await import("../src/view/pdf-photo-restore.js");
  const id = [1, 0, 0, 1, 0, 0];
  const view = { transform: id, width: 100, height: 100 };
  assert.deepEqual(
    photoFracs({ fnArray: [12, 85], argsArray: [[50, 0, 0, 40, 10, 20], ["Im1"]] }, view),
    [[0.1, 0.2, 0.5, 0.4]],
  );
  assert.deepEqual(
    photoFracs({
      fnArray: [10, 12, 83, 11, 12, 85],
      argsArray: [[], [80, 0, 0, 80, 0, 0], ["Mask"], [], [50, 0, 0, 40, 10, 20], ["Im1"]],
    }, view),
    [[0.1, 0.2, 0.5, 0.4]],
  );
  assert.deepEqual(
    photoFracs({ fnArray: [12, 85], argsArray: [[4, 0, 0, 4, 10, 20], ["ImTiny"]] }, view),
    [],
  );

  const row = createSettingsPanel().settings.find((entry) => entry.id === "pdf-reader-dark");
  assert.equal(row.description.includes("stay natural"), false);
  assert.match(row.description, /invert with the text/);
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  assert.equal(readme.includes("stay natural"), false);
  assert.match(readme, /invert with the text/);
  assert.match(readme, /\| PDF reader \| PDF dark mode \|/);
  const css = readFileSync(new URL("../src/css/read-pane.css", import.meta.url), "utf8");
  assert.match(css, /canvas:not\(\.pxd-pdf-photo\)/);
  const paneAt = css.indexOf("html.pxd-pdf-reader-dark .pxd-read .rm-pdf-container .page > canvas");
  assert.ok(paneAt > css.indexOf("html.pxd-pdf-reader-dark .rm-pdf-container .page > canvas"));
  assert.match(css.slice(paneAt, css.indexOf("}", paneAt)), /filter:\s*none/);

  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const orig = doc.createElement.bind(doc);
    doc.createElement = (tag) => {
      const el = orig(tag);
      if (String(tag).toLowerCase() === "canvas") {
        el.getContext = () => ({
          drawImage() { el._drew = (el._drew || 0) + 1; },
          clearRect() {},
        });
      }
      return el;
    };
    const read = orig("div");
    read.className = "pxd-read";
    const inside = orig("div");
    read.append(inside);
    const root = orig("div");
    root.className = "pxd-root";
    const insideRoot = orig("div");
    root.append(insideRoot);
    assert.equal(shouldRestoreContainer(inside), false);
    assert.equal(shouldRestoreContainer(insideRoot), false);
    assert.equal(shouldRestoreContainer(orig("div")), true);

    let calls = 0;
    const pdfPage = {
      fingerprints: ["abc"],
      getViewport: () => ({ transform: id, width: 100, height: 100 }),
      getOperatorList() {
        calls += 1;
        return { fnArray: [12, 85], argsArray: [[50, 0, 0, 40, 10, 20], ["Im1"]] };
      },
    };
    const box = doc.createElement("div");
    box.className = "rm-pdf-container";
    const page = doc.createElement("div");
    page.className = "page";
    page.setAttribute("data-page-number", "1");
    page.pdfPage = pdfPage;
    const canvas = doc.createElement("canvas");
    canvas.width = 100;
    canvas.height = 100;
    page.append(canvas);
    box.append(page);
    applyPdfReaderDark(doc, true);
    doc.body.append(box);
    stub.flushMutations();
    await new Promise((r) => setTimeout(r, 0));
    const photo = page.querySelector(".pxd-pdf-photo");
    assert.ok(photo);
    assert.equal(canvas.nextElementSibling, photo);
    assert.ok(photo._drew >= 1);
    assert.equal(calls, 1);

    const seen = calls;
    page.append(canvas);
    stub.flushMutations();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(calls, seen);

    let readCalls = 0;
    const readBox = doc.createElement("div");
    readBox.className = "rm-pdf-container";
    const readPage = doc.createElement("div");
    readPage.className = "page";
    readPage.pdfPage = {
      fingerprints: ["read"],
      getViewport: () => ({ transform: id, width: 100, height: 100 }),
      getOperatorList() {
        readCalls += 1;
        return { fnArray: [12, 85], argsArray: [[50, 0, 0, 40, 10, 20], ["Im1"]] };
      },
    };
    const readCanvas = doc.createElement("canvas");
    readCanvas.width = 100;
    readCanvas.height = 100;
    readPage.append(readCanvas);
    readBox.append(readPage);
    read.append(readBox);
    doc.body.append(read);
    stub.flushMutations();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(readBox.querySelector(".pxd-pdf-photo"), null);
    assert.equal(readCalls, 0);

    applyPdfReaderDark(doc, false);
    assert.equal(doc.querySelectorAll(".pxd-pdf-photo").length, 0);
    const later = doc.createElement("div");
    later.className = "rm-pdf-container";
    const laterPage = doc.createElement("div");
    laterPage.className = "page";
    laterPage.pdfPage = pdfPage;
    const laterCanvas = doc.createElement("canvas");
    laterCanvas.width = 100;
    laterCanvas.height = 100;
    laterPage.append(laterCanvas);
    later.append(laterPage);
    doc.body.append(later);
    stub.flushMutations();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(later.querySelector(".pxd-pdf-photo"), null);
    assert.equal(calls, seen);
  } finally {
    restore();
  }
});
