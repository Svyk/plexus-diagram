// PDF-U1 warm mount and reader snapshot.
// Live reader: .rm-pdf-container, toolbar, .page[data-page-number], canvas 512×688.
// The warm must not mount on the call that asks, and a failure must not throw.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { WARM_MAX } from "../src/model/pdf-cover.js";
import { COVER_JPEG, WARM_POLL_MS, WARM_TIMEOUT_MS, createPdfWarm } from "../src/view/pdf-warm.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const PDF_URL = "https://example.test/papers/Risk%20model.pdf.enc?alt=media&token=abc";

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

function fakeTimers() {
  let next = 1;
  const items = [];
  return {
    items,
    setTimeout(fn, ms) {
      const id = next;
      next += 1;
      items.push({ id, fn, ms, cleared: false });
      return id;
    },
    clearTimeout(id) {
      const item = items.find((timer) => timer.id === id);
      if (item) item.cleared = true;
    },
    flush(ms) {
      const due = items.filter((timer) => !timer.cleared && timer.ms === ms);
      for (const timer of due) timer.cleared = true;
      for (const timer of due) timer.fn();
    },
    pending(ms) {
      return items.filter((timer) => !timer.cleared && timer.ms === ms).length;
    },
  };
}

function memoryStore() {
  const map = new Map();
  const calls = [];
  return {
    map,
    calls,
    async get(url) {
      calls.push(["get", url]);
      return map.get(url) || null;
    },
    async put(record) {
      calls.push(["put", record.url]);
      map.set(record.url, record);
      return record;
    },
    async remove(url) {
      map.delete(url);
      return true;
    },
  };
}

function equip(el, shots, tainted) {
  el.getContext = () => ({
    drawImage(src) { el._src = src; },
  });
  el.toBlob = (cb, type, quality) => {
    if (tainted()) throw new Error("tainted canvas");
    shots.push({ type, quality, w: el.width, h: el.height, marker: el._src?._marker || "" });
    cb(new Blob([el._src?._marker || ""], { type: type || "image/jpeg" }));
  };
}

function harness({ tainted = false, paint } = {}) {
  const stub = createDomStub();
  const doc = stub.document;
  const shots = [];
  const orig = doc.createElement.bind(doc);
  doc.createElement = (tag) => {
    const el = orig(tag);
    if (String(tag).toLowerCase() === "canvas") equip(el, shots, () => tainted);
    return el;
  };
  const root = doc.createElement("div");
  root.className = "pxd-root";
  doc.body.append(root);
  const timers = fakeTimers();
  const store = memoryStore();
  const calls = [];
  const host = {
    calls,
    renderBlock(el, uid) {
      calls.push(["render", uid]);
      paint?.(el, uid, doc);
    },
    unmount(el) {
      calls.push(["unmount"]);
      el?.replaceChildren?.();
    },
    updateBlock() { calls.push(["write"]); },
    createBlock() { calls.push(["write"]); },
  };
  const warm = createPdfWarm({
    doc,
    root,
    host,
    store,
    timers,
    now: () => 12345,
  });
  return { stub, doc, root, timers, store, host, warm, shots };
}

function paintPages(parent, doc, pages) {
  const box = doc.createElement("div");
  box.className = "rm-pdf-container";
  const toolbar = doc.createElement("div");
  toolbar.className = "rm-pdf-toolbar";
  const input = doc.createElement("input");
  input.className = "bp3-input";
  input.value = "3";
  const total = doc.createElement("span");
  total.textContent = "/ 9";
  toolbar.append(input, total);
  const viewer = doc.createElement("div");
  viewer.className = "rm-pdf-viewer-container";
  const canvases = [];
  for (const page of pages) {
    const node = doc.createElement("div");
    node.className = "page";
    node.setAttribute("data-page-number", String(page.n));
    const canvas = doc.createElement("canvas");
    canvas.width = page.w;
    canvas.height = page.h;
    canvas._marker = page.marker;
    node.append(canvas);
    viewer.append(node);
    canvases.push(canvas);
  }
  box.append(toolbar, viewer);
  parent.append(box);
  return canvases;
}

function card(over) {
  return {
    uid: "card-1",
    blockUid: "block-1",
    url: PDF_URL,
    hash: "hash-1",
    ...over,
  };
}

test("warm budget constants", () => {
  assert.equal(WARM_TIMEOUT_MS, 8000);
  assert.equal(WARM_POLL_MS, 100);
  assert.equal(COVER_JPEG, 0.72);
});

test("create and the request call mount nothing synchronously", () => {
  const { root, host, warm, timers } = harness();
  assert.equal(root.querySelector(".pxd-pdf-warm"), null);
  assert.equal(timers.items.length, 0);
  const pending = warm.request(card());
  assert.equal(root.querySelector(".pxd-pdf-warm"), null);
  assert.equal(host.calls.length, 0);
  assert.equal(warm.running(), true);
  assert.equal(warm.outcome("card-1"), "loading");
  warm.cancelAll();
  assert.equal(warm.running(), false);
  assert.equal(warm.outcome("card-1"), "idle");
  assert.equal(warm.spent(), 0);
  return pending.then((result) => {
    assert.equal(result, null);
    assert.equal(host.calls.length, 0);
    assert.equal(root.querySelector(".pxd-pdf-warm"), null);
  });
});

test("the hidden holder is off-viewport, visibility hidden, and never display none", async () => {
  const { root, timers, warm, host } = harness({
    paint(el, uid, doc) {
      assert.equal(uid, "block-1");
      paintPages(el, doc, [{ n: 1, marker: "page-1", w: 0, h: 0 }]);
    },
  });
  const pending = warm.request(card());
  timers.flush(0);
  await tick();
  const holder = root.querySelector(".pxd-pdf-warm");
  assert.ok(holder);
  assert.equal(holder.style.position, "absolute");
  assert.equal(holder.style.left, "-10000px");
  assert.equal(holder.style.top, "0");
  assert.equal(holder.style.width, "640px");
  assert.equal(holder.style.height, "900px");
  assert.equal(holder.style.visibility, "hidden");
  assert.equal(holder.style.pointerEvents, "none");
  assert.equal(holder.style.display || "", "");
  assert.equal(holder.getAttribute("aria-hidden"), "true");
  assert.equal(host.calls.some((call) => call[0] === "write"), false);
  warm.cancelAll();
  assert.equal(root.querySelector(".pxd-pdf-warm"), null);
  assert.equal(root.querySelector(".rm-pdf-container"), null);
  assert.deepEqual(host.calls.map((call) => call[0]), ["render", "unmount"]);
  assert.equal(await pending, null);
  assert.equal(warm.spent(), 0);
  assert.equal(warm.outcome("card-1"), "idle");
});

test("an 8s miss unmounts, spends a slot, and stores nothing", async () => {
  const { root, timers, store, warm, host } = harness({
    paint(el, uid, doc) {
      paintPages(el, doc, [{ n: 1, marker: "page-1", w: 0, h: 0 }]);
    },
  });
  const pending = warm.request(card());
  timers.flush(0);
  await tick();
  assert.ok(root.querySelector(".pxd-pdf-warm"));
  assert.equal(store.calls.some((call) => call[0] === "put"), false);
  timers.flush(WARM_TIMEOUT_MS);
  assert.equal(await pending, null);
  assert.equal(root.querySelector(".pxd-pdf-warm"), null);
  assert.equal(root.querySelector(".rm-pdf-container"), null);
  assert.equal(warm.outcome("card-1"), "error");
  assert.equal(warm.spent(), 1);
  assert.equal(store.map.size, 0);
  assert.equal(host.calls.filter((call) => call[0] === "unmount").length, 1);
  assert.equal(timers.pending(WARM_TIMEOUT_MS), 0);
});

test("a late canvas is snapshotted at 320×430 from page 1, then the holder is gone", async () => {
  let pageCanvas = null;
  const { root, timers, store, warm, shots, host } = harness({
    paint(el, _uid, doc) {
      const canvases = paintPages(el, doc, [
        { n: 1, marker: "page-1", w: 0, h: 0 },
        { n: 3, marker: "page-3", w: 512, h: 688 },
      ]);
      pageCanvas = canvases[0];
    },
  });
  const pending = warm.request(card({ pageCount: undefined }));
  timers.flush(0);
  await tick();
  assert.equal(store.map.size, 0, "a zero-width page-1 canvas is not a cover");
  pageCanvas.width = 512;
  pageCanvas.height = 688;
  timers.flush(WARM_POLL_MS);
  const saved = await pending;
  assert.equal(await saved.first.text(), "page-1");
  assert.equal(saved.last, null);
  assert.equal(saved.w, 320);
  assert.equal(saved.h, 430);
  assert.equal(saved.pageCount, 3);
  assert.equal(saved.hash, "hash-1");
  assert.equal(saved.url, PDF_URL);
  assert.equal(saved.ts, 12345);
  assert.deepEqual(shots.at(-1), { type: "image/jpeg", quality: 0.72, w: 320, h: 430, marker: "page-1" });
  assert.equal(root.querySelector(".pxd-pdf-warm"), null);
  assert.equal(root.querySelector(".rm-pdf-container"), null);
  assert.equal(warm.outcome("card-1"), "ready");
  assert.equal(warm.spent(), 1);
  assert.equal(warm.running(), false);
  timers.flush(WARM_TIMEOUT_MS);
  assert.equal(warm.outcome("card-1"), "ready");
  assert.equal(host.calls.some((call) => call[0] === "write"), false);
});

test("snapshotFrom reads the .page whose data-page-number matches", async () => {
  const { doc, warm, store, shots, host } = harness();
  const reader = doc.createElement("div");
  const canvases = paintPages(reader, doc, [
    { n: 1, marker: "page-1", w: 512, h: 688 },
    { n: 3, marker: "page-3", w: 0, h: 0 },
  ]);
  assert.equal(reader.querySelector(".rm-pdf-toolbar input").value, "3");
  assert.equal(reader.querySelector("span").textContent, "/ 9");
  assert.equal(await warm.snapshotFrom(reader, { page: 3, url: PDF_URL, hash: "h", pageCount: 9, as: "last" }), null);
  assert.equal(store.map.size, 0);
  canvases[1].width = 400;
  canvases[1].height = 600;
  const last = await warm.snapshotFrom(reader, { page: 3, url: PDF_URL, hash: "h", pageCount: 9, as: "last" });
  assert.equal(await last.last.text(), "page-3");
  assert.equal(last.first, null);
  assert.equal(last.lastPage, 3);
  assert.equal(last.pageCount, 9);
  assert.equal(last.w, 320);
  assert.equal(last.h, 480);
  const first = await warm.snapshotFrom(reader, { page: 1, url: PDF_URL, hash: "h", pageCount: 9, as: "first" });
  assert.equal(await first.first.text(), "page-1");
  assert.equal(await first.last.text(), "page-3");
  assert.equal(first.lastPage, 3);
  assert.equal(first.w, 320);
  assert.equal(first.h, 430);
  assert.equal(await warm.snapshotFrom(reader, { page: 2, url: PDF_URL, hash: "h", as: "last" }), null);
  assert.deepEqual(shots.map((shot) => shot.marker), ["page-3", "page-1"]);
  assert.ok(shots.every((shot) => shot.type === "image/jpeg" && shot.quality === 0.72));
  assert.equal(host.calls.length, 0, "a reader snapshot does not mount");
});

test("a tainted canvas resolves null and does not log", async () => {
  const errors = [];
  const orig = console.error;
  console.error = (...args) => { errors.push(args); };
  try {
    const { doc, warm, store } = harness({ tainted: true });
    const reader = doc.createElement("div");
    paintPages(reader, doc, [{ n: 1, marker: "page-1", w: 512, h: 688 }]);
    await assert.doesNotReject(async () => {
      assert.equal(await warm.snapshotFrom(reader, { page: 1, url: PDF_URL, hash: "h", as: "first" }), null);
    });
    assert.equal(store.map.size, 0);
    assert.equal(errors.length, 0);
  } finally {
    console.error = orig;
  }
});

test("a warm whose canvas is tainted unmounts as none and does not store", async () => {
  const { root, timers, store, warm } = harness({
    tainted: true,
    paint(el, _uid, doc) {
      paintPages(el, doc, [{ n: 1, marker: "page-1", w: 512, h: 688 }]);
    },
  });
  const pending = warm.request(card());
  timers.flush(0);
  await tick();
  assert.equal(await pending, null);
  assert.equal(warm.outcome("card-1"), "none");
  assert.equal(warm.spent(), 1);
  assert.equal(store.map.size, 0);
  assert.equal(root.querySelector(".pxd-pdf-warm"), null);
  assert.equal(root.querySelector(".rm-pdf-container"), null);
});

test("a reader already on the page skips the warm", async () => {
  const { doc, root, timers, warm, host } = harness({
    paint(el, _uid, document) {
      paintPages(el, document, [{ n: 1, marker: "page-1", w: 512, h: 688 }]);
    },
  });
  const open = doc.createElement("div");
  open.className = "rm-pdf-container";
  doc.body.append(open);
  const pending = warm.request(card());
  timers.flush(0);
  await tick();
  assert.equal(await pending, null);
  assert.equal(root.querySelector(".pxd-pdf-warm"), null);
  assert.equal(host.calls.length, 0);
  assert.equal(warm.outcome("card-1"), "skipped");
  assert.equal(warm.spent(), 0);
  assert.equal(doc.querySelectorAll(".rm-pdf-container").length, 1);
});

test("an outline reader below the window does not skip the warm", async () => {
  const { doc, root, timers, warm, host } = harness({
    paint(el, _uid, document) {
      paintPages(el, document, [{ n: 1, marker: "page-1", w: 0, h: 0 }]);
    },
  });
  doc.defaultView = { innerWidth: 800, innerHeight: 600 };
  const open = doc.createElement("div");
  open.className = "rm-pdf-container";
  open._rect = { left: 0, top: 900, width: 428, height: 700, right: 428, bottom: 1600, x: 0, y: 900 };
  doc.body.append(open);
  const pending = warm.request(card());
  timers.flush(0);
  await tick();
  assert.ok(root.querySelector(".pxd-pdf-warm"));
  assert.equal(host.calls.some((call) => call[0] === "render"), true);
  assert.notEqual(warm.outcome("card-1"), "skipped");
  warm.cancelAll();
  assert.equal(await pending, null);
});

test("a reader inside the window still skips the warm", async () => {
  const { doc, root, timers, warm, host } = harness({
    paint(el, _uid, document) {
      paintPages(el, document, [{ n: 1, marker: "page-1", w: 512, h: 688 }]);
    },
  });
  doc.defaultView = { innerWidth: 800, innerHeight: 600 };
  const open = doc.createElement("div");
  open.className = "rm-pdf-container";
  open._rect = { left: 40, top: 80, width: 428, height: 400, right: 468, bottom: 480, x: 40, y: 80 };
  doc.body.append(open);
  const pending = warm.request(card());
  timers.flush(0);
  await tick();
  assert.equal(await pending, null);
  assert.equal(root.querySelector(".pxd-pdf-warm"), null);
  assert.equal(host.calls.length, 0);
  assert.equal(warm.outcome("card-1"), "skipped");
});

test("a stored first page is a cache hit and does not render", async () => {
  const { store, timers, warm, host } = harness();
  const first = new Blob(["kept"], { type: "image/jpeg" });
  store.map.set(PDF_URL, { url: PDF_URL, hash: "hash-1", first, last: null, w: 320, h: 430 });
  const pending = warm.request(card());
  timers.flush(0);
  assert.equal(await pending, store.map.get(PDF_URL));
  assert.equal(host.calls.length, 0);
  assert.equal(warm.outcome("card-1"), "ready");
  assert.equal(warm.spent(), 0);
});

test("one warm at a time, and the mount past WARM_MAX does not start", async () => {
  const { root, timers, warm, host } = harness({
    paint(el, _uid, doc) {
      paintPages(el, doc, [{ n: 1, marker: "page-1", w: 0, h: 0 }]);
    },
  });
  const first = warm.request(card());
  const second = warm.request(card({ uid: "card-2", blockUid: "block-2" }));
  assert.equal(await second, null);
  timers.flush(0);
  await tick();
  assert.equal(root.querySelectorAll(".pxd-pdf-warm").length, 1);
  timers.flush(WARM_TIMEOUT_MS);
  assert.equal(await first, null);
  assert.equal(warm.spent(), 1);

  for (let i = 2; i <= WARM_MAX; i += 1) {
    const pending = warm.request(card({ uid: `card-${i}`, blockUid: `block-${i}` }));
    timers.flush(0);
    await tick();
    timers.flush(WARM_TIMEOUT_MS);
    assert.equal(await pending, null);
  }
  assert.equal(warm.spent(), WARM_MAX);
  const extra = warm.request(card({ uid: "card-extra", blockUid: "block-extra" }));
  assert.equal(await extra, null);
  assert.equal(timers.pending(0), 0);
  assert.equal(host.calls.filter((call) => call[0] === "render").length, WARM_MAX);
});

test("renderBlock throwing unmounts as error and does not log", async () => {
  const errors = [];
  const orig = console.error;
  console.error = (...args) => { errors.push(args); };
  try {
    const stub = createDomStub();
    const root = stub.document.createElement("div");
    stub.document.body.append(root);
    const timers = fakeTimers();
    const warm = createPdfWarm({
      doc: stub.document,
      root,
      host: {
        renderBlock() { throw new Error("render failed"); },
        unmount() {},
      },
      store: memoryStore(),
      timers,
      now: () => 1,
    });
    const pending = warm.request(card());
    timers.flush(0);
    await tick();
    assert.equal(await pending, null);
    assert.equal(warm.outcome("card-1"), "error");
    assert.equal(root.querySelector(".pxd-pdf-warm"), null);
    assert.equal(errors.length, 0);
  } finally {
    console.error = orig;
  }
});

test("the warm module has no graph write, no log, and no display none", () => {
  const text = readFileSync(new URL("../src/view/pdf-warm.js", import.meta.url), "utf8");
  assert.equal(text.includes("roamAlphaAPI"), false);
  assert.equal(text.includes(":diagram"), false);
  assert.equal(text.includes("console."), false);
  assert.equal(text.includes("display: none"), false);
  assert.equal(text.includes("display:none"), false);
  assert.equal(text.includes('display = "none"'), false);
});
