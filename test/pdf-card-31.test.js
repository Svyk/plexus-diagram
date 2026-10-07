// PDF-U2 board card: cover faces, density ticks, reading class, Open pill, blob revoke.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { coverModel } from "../src/model/pdf.js";
import { createItemRenderer } from "../src/view/cards.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const SELF = "{{[[pdf]]: https://example.test/self.pdf}}";
const REF = "{{[[pdf]]: https://example.test/ref.pdf}}";

function raw(children) {
  return {
    ":block/uid": "boardpdfu",
    ":block/string": "{{[[diagram]]:PDFs}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": children,
  };
}

function child(uid, string, order) {
  return {
    ":block/uid": uid,
    ":block/string": string,
    ":block/order": order,
    ":block/props": { ":plexus": { ":x": order * 320, ":y": 0, ":w": 240, ":h": 320 } },
    ":block/children": [],
  };
}

function mount(opts = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const itemsLayer = doc.createElement("div");
  const sectionsLayer = doc.createElement("div");
  doc.body.append(sectionsLayer, itemsLayer);
  const idleQueue = [];
  const asked = [];
  const opened = [];
  const requested = [];
  const pane = [];
  const images = opts.images || new Map();
  const host = {
    renderString(node, string) { node.textContent = string; },
    renderBlock(node) {
      const box = doc.createElement("div");
      box.className = "rm-pdf-container";
      node.append(box);
    },
    unmount() {},
    blockString(uid) { return uid === "pdfblock1" ? REF : ""; },
    pdfCover(string) {
      if (typeof opts.pdfCover === "function") return opts.pdfCover(string);
      if (string === SELF) return coverModel({ title: "Self paper", url: "https://example.test/self.pdf", count: opts.count ?? 2 });
      if (string === REF) return coverModel({ title: "Ref paper", url: "https://example.test/ref.pdf", count: opts.count ?? 2 });
      return coverModel({ count: 0 });
    },
    updateProps() {},
  };
  const r = createItemRenderer({
    doc,
    host,
    session: { updateProps() {}, setString() {} },
    itemsLayer,
    sectionsLayer,
    timers: {
      idle(fn) { idleQueue.push(fn); return () => {}; },
      later() { return () => {}; },
    },
    pdfChips: opts.pdfChips,
    onPdfOpen(uid, page) { opened.push([uid, page]); },
    onPdfOpenRequest(uid) { requested.push(uid); },
    onReadPane: opts.onReadPane ? (detail) => { pane.push(detail); opts.onReadPane(detail); } : undefined,
    coverImage(url) {
      asked.push(url);
      if (typeof opts.coverImage === "function") return opts.coverImage(url);
      return images.get(url) ?? null;
    },
    readingUid: opts.readingUid,
  });
  const board = buildBoard(raw(opts.children || [
    child("pdfself01", SELF, 0),
  ]), { resolve: (uid) => (uid === "pdfblock1" ? REF : "") });
  const rects = worldRects(board);
  const flush = () => {
    let guard = 0;
    while (idleQueue.length && guard++ < 30) idleQueue.shift()({ timeRemaining: () => 10 });
  };
  r.sync({ board, rects, structural: true });
  r.setLod("detail", 1);
  r.scheduleContent({ visibleRect: { x: -100, y: -100, w: 4000, h: 2000 }, zoom: 1, tier: "detail" });
  flush();
  return {
    stub, r, board, rects, flush, asked, opened, requested, pane,
    shell: () => r.shellOf("pdfself01"),
    cover: () => r.shellOf("pdfself01").querySelector(".pxd-pdf-cover"),
    restore() { r.dispose(); restore(); },
  };
}

test("each cover state paints its face and detail ready has no text on the paper", () => {
  const faces = {
    "https://example.test/load.pdf": { state: "loading" },
    "https://example.test/none.pdf": { state: "none" },
    "https://example.test/bad.pdf": { state: "error" },
    "https://example.test/ok.pdf": { state: "ready", src: "https://example.test/ok.jpg", w: 320, h: 430 },
  };
  const urls = Object.keys(faces);
  const ctx = mount({
    count: 1,
    children: urls.map((url, i) => child(`pdfcard0${i}`, `{{[[pdf]]: ${url}}}`, i)),
    pdfCover(string) {
      const url = string.replace("{{[[pdf]]: ", "").replace("}}", "");
      return coverModel({ title: url.includes("ok") ? "Ready paper" : "Quiet paper", url, count: 1 });
    },
    coverImage(url) { return faces[url]; },
  });
  try {
    const card = (i) => ctx.r.shellOf(`pdfcard0${i}`);
    const loading = card(0).querySelector(".pxd-pdf-cover");
    assert.equal(loading.getAttribute("data-cover"), "loading");
    assert.equal(loading.querySelectorAll(".pxd-pdf-skel__line").length, 6);
    assert.equal(loading.querySelector(".pxd-pdf-title--face").textContent, "Quiet paper");
    assert.equal(loading.querySelector("img"), null);

    const none = card(1).querySelector(".pxd-pdf-cover");
    assert.equal(none.getAttribute("data-cover"), "none");
    assert.ok(none.querySelector(".pxd-pdf-glyph"));
    assert.equal(none.querySelector(".pxd-pdf-title--face").textContent, "Quiet paper");
    assert.equal(none.querySelector("img"), null);

    const error = card(2).querySelector(".pxd-pdf-cover");
    assert.equal(error.getAttribute("data-cover"), "error");
    assert.ok(error.querySelector(".pxd-pdf-glyph"));
    assert.equal(error.textContent.includes("Could not read"), true);
    assert.equal(error.querySelector(".pxd-pdf-title--face"), null);
    assert.equal(error.querySelector("img"), null);

    const ready = card(3).querySelector(".pxd-pdf-cover");
    assert.equal(ready.getAttribute("data-cover"), "ready");
    const img = ready.querySelector("img.pxd-pdf-img");
    assert.equal(img.getAttribute("src"), "https://example.test/ok.jpg");
    assert.equal(img.getAttribute("decoding"), "async");
    assert.equal(img.getAttribute("loading"), "lazy");
    assert.equal(ready.querySelector(".pxd-pdf-title--face"), null);
    assert.equal(ready.querySelector(".pxd-pdf-title").textContent, "Ready paper");
  } finally {
    ctx.restore();
  }
});

test("map lod hides the image and overview is paper only", () => {
  const ctx = mount({
    images: new Map([["https://example.test/self.pdf", { state: "ready", src: "https://example.test/self.jpg" }]]),
  });
  try {
    assert.ok(ctx.cover().querySelector("img"));
    ctx.r.setLod("map", 0.3);
    ctx.flush();
    const map = ctx.cover();
    assert.equal(map.querySelector("img"), null);
    assert.equal(map.querySelector(".pxd-pdf-title").textContent, "Self paper");

    ctx.r.setLod("detail", 1);
    ctx.flush();
    ctx.r.setLod("overview", 0.08);
    ctx.flush();
    const overview = ctx.cover();
    assert.equal(overview.querySelector("img"), null);
    assert.equal(overview.querySelector(".pxd-pdf-title"), null);
    assert.equal(overview.querySelector(".pxd-pdf-hover"), null);
    assert.equal(overview.querySelector(".pxd-pdf-pill"), null);
    assert.equal(overview.querySelector(".pxd-pdf-density"), null);
    assert.ok(overview.querySelector(".pxd-pdf-paper"));
  } finally {
    ctx.restore();
  }
});

test("the hover strip hides at count 0 and holds the page chips otherwise", () => {
  const empty = mount({ count: 0 });
  try {
    const hover = empty.cover().querySelector(".pxd-pdf-hover");
    assert.equal(hover.hasAttribute("hidden"), true);
    assert.equal(hover.querySelector(".pxd-pdf-count"), null);
  } finally {
    empty.restore();
  }
  const full = mount({
    count: 2,
    pdfChips: () => [{ page: 2, count: 1, uids: ["hlone0001"] }],
  });
  try {
    const hover = full.cover().querySelector(".pxd-pdf-hover");
    assert.equal(hover.hasAttribute("hidden"), false);
    assert.equal(hover.querySelector(".pxd-pdf-count").textContent, "2");
    assert.equal(hover.querySelector(".pxd-pdf-count").getAttribute("aria-label"), "2 highlights");
    assert.ok(hover.querySelector(".pxd-pdf-chips"));
    assert.equal(full.cover().querySelector(".pxd-pdf-paper .pxd-pdf-chips"), null);
  } finally {
    full.restore();
  }
});

test("density ticks sit at y01 and a tick with a page opens that page", () => {
  const y = 1 / 3;
  const ctx = mount({
    images: new Map([["https://example.test/self.pdf", {
      state: "ready",
      src: "https://example.test/self.jpg",
      ticks: [{ y01: 0, color: "yellow" }, { y01: y, color: "blue", page: 2 }, { y01: 2, color: "red", page: 4 }],
    }]]),
  });
  try {
    const ticks = [...ctx.cover().querySelectorAll("button.pxd-pdf-tick")];
    assert.equal(ticks.length, 3);
    assert.equal(ticks[0].getAttribute("data-y01"), "0");
    assert.equal(ticks[0].style.top, "0%");
    assert.equal(ticks[0].getAttribute("data-color"), "yellow");
    assert.equal(ticks[0].hasAttribute("data-page"), false);
    assert.equal(ticks[1].getAttribute("data-y01"), String(y));
    assert.equal(ticks[1].style.top, `${y * 100}%`);
    assert.equal(ticks[1].getAttribute("data-page"), "2");
    assert.equal(ticks[2].style.top, "100%");
    ticks[1].click();
    assert.deepEqual(ctx.opened, [["pdfself01", 2]]);
  } finally {
    ctx.restore();
  }
  const bare = mount({
    images: new Map([["https://example.test/self.pdf", { state: "ready", src: "https://example.test/self.jpg", ticks: [] }]]),
  });
  try {
    assert.equal(bare.cover().querySelector(".pxd-pdf-density"), null);
  } finally {
    bare.restore();
  }
});

test("the reading class follows readingUid and repaintStyles swaps a loading face for the image", () => {
  let reading = "pdfself01";
  let image = { state: "loading" };
  const ctx = mount({
    readingUid: () => reading,
    coverImage: () => image,
  });
  try {
    assert.equal(ctx.shell().classList.contains("pxd-item--reading"), true);
    assert.ok(ctx.cover().querySelector(".pxd-pdf-dot"));
    assert.equal(ctx.cover().querySelector("img"), null);
    reading = "";
    image = { state: "ready", src: "data:image/jpeg;base64,abc" };
    ctx.r.repaintStyles();
    assert.equal(ctx.shell().classList.contains("pxd-item--reading"), false);
    assert.equal(ctx.cover().querySelector("img").getAttribute("src"), "data:image/jpeg;base64,abc");
  } finally {
    ctx.restore();
  }
});

test("Enter, Space, and double-click on a selected card ask for the pane; the pill still opens", () => {
  const ctx = mount({
    onReadPane() {},
    pdfChips: () => [{ page: 3, count: 1, uids: ["hlone0001"] }],
  });
  try {
    const shell = ctx.shell();
    const pill = ctx.cover().querySelector("button.pxd-pdf-open");
    assert.equal(pill.textContent, "Open");
    assert.equal(pill.getAttribute("aria-label"), "Open reader");
    ctx.stub.dispatch(shell, "keydown", { key: "Enter" });
    ctx.stub.dispatch(shell, "keydown", { key: " " });
    ctx.stub.dispatch(ctx.cover(), "dblclick");
    assert.deepEqual(ctx.requested, []);
    pill.click();
    assert.equal(ctx.pane.length, 1);
    assert.deepEqual(ctx.requested, []);
    assert.equal(shell.querySelector(".pxd-pdf-reader"), null);

    ctx.r.setSelection(["pdfself01"]);
    ctx.stub.dispatch(shell, "keydown", { key: "Enter" });
    ctx.stub.dispatch(shell, "keydown", { key: " " });
    ctx.stub.dispatch(ctx.cover().querySelector(".pxd-pdf-paper"), "dblclick");
    assert.deepEqual(ctx.requested, ["pdfself01", "pdfself01", "pdfself01"]);

    const chip = ctx.cover().querySelector("button.pxd-pdf-chip");
    ctx.stub.dispatch(chip, "keydown", { key: "Enter" });
    ctx.stub.dispatch(pill, "dblclick");
    assert.deepEqual(ctx.requested, ["pdfself01", "pdfself01", "pdfself01"]);
    assert.equal(shell.querySelector(".pxd-pdf-reader"), null);
  } finally {
    ctx.restore();
  }
});

test("a blob cover url is revoked on unmount and a data url is not", () => {
  const revoked = [];
  const orig = globalThis.URL.revokeObjectURL;
  globalThis.URL.revokeObjectURL = (url) => {
    revoked.push(String(url));
    try { orig.call(globalThis.URL, url); } catch { /* not a live object url */ }
  };
  const blob = "blob:https://example.test/cover";
  const ctx = mount({
    images: new Map([["https://example.test/self.pdf", { state: "ready", src: blob }]]),
  });
  try {
    assert.equal(ctx.cover().querySelector("img").getAttribute("src"), blob);
    ctx.restore();
    assert.deepEqual(revoked, [blob]);
  } finally {
    globalThis.URL.revokeObjectURL = orig;
  }
  const data = mount({
    images: new Map([["https://example.test/self.pdf", { state: "ready", src: "data:image/jpeg;base64,zzz" }]]),
  });
  const seen = [];
  const prev = globalThis.URL.revokeObjectURL;
  globalThis.URL.revokeObjectURL = (url) => { seen.push(String(url)); };
  try {
    data.restore();
    assert.deepEqual(seen, []);
  } finally {
    globalThis.URL.revokeObjectURL = prev;
  }
});

test("cover css keeps the paper white and does not follow the OS color scheme", () => {
  const css = readFileSync(new URL("../src/css/pdf-cover.css", import.meta.url), "utf8");
  assert.match(css, /--pxd-pdf-paper:\s*#ffffff/);
  assert.match(css, /\.pxd-root\.pxd-root--dark \{[\s\S]*--pxd-pdf-paper:\s*#ffffff/);
  assert.match(css, /\.pxd-root\.pxd-root--dark \{[\s\S]*--pxd-pdf-shadow:\s*none/);
  assert.equal(css.includes("prefers-color-scheme"), false);
  assert.equal(css.includes(":root:not(.bp3-light)"), false);
  assert.match(css, /object-fit:\s*cover/);
  assert.match(css, /object-position:\s*top center/);
});
