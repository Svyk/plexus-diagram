// PXD-4: the first zoom-in of a session. steadyRows (3.36.0) painted a page card's last outline as plain rows from the
// tier flip, but nothing was painted yet in a new session, so page cards sat as empty boxes until the content pass.
// The board's ref read already pulled each page card's page into the host session cache: the preview seeds from it.
import assert from "node:assert/strict";
import test from "node:test";

import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";
import { buildBoard, worldRects } from "../src/model/board.js";
import { createItemRenderer } from "../src/view/cards.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { noteSpeedFlags } from "../src/settings.js";

const props = (x, y) => ({ plexus: { x, y, w: 260, h: 240 } });

function seededHost() {
  const fake = createFakeRoam({ pullMany: true });
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedPage({
    title: "Alpha",
    uid: "pgAlpha01",
    children: [
      { uid: "al1", string: "first row", children: [{ uid: "al1a", string: "nested row" }] },
      { uid: "al2", string: "folded row", open: false, children: Array.from({ length: 300 }, (_, i) => ({ uid: `fk${i}`, string: `hidden ${i}` })) },
      { uid: "al3", string: "row after the fold" },
    ],
  });
  fake.seedPage({ title: "Beta", uid: "pgBeta001", children: [{ uid: "be1", string: "beta row" }] });
  fake.seedPage({ title: "Empty", uid: "pgEmpty01" });
  fake.seedBoard({
    uid: "board0001",
    props: { plexus: { v: 2 } },
    children: [
      { uid: "cardA0001", string: "[[Alpha]]", props: props(0, 0) },
      { uid: "cardB0001", string: "[[Beta]]", props: props(400, 0) },
      { uid: "cardE0001", string: "[[Empty]]", props: props(800, 0) },
    ],
  });
  return { fake, host };
}

test("PXD-4 host: cachedPageOutline answers only from the board's ref read and never reads Roam", () => {
  const { fake, host } = seededHost();
  fake.pullLog = [];
  assert.equal(host.cachedPageOutline("Alpha"), null, "no board read yet: nothing cached");
  assert.equal(fake.pullLog.length, 0, "a miss does not pull the page");
  assert.ok(host.pullBoard("board0001"));
  fake.pullLog = [];
  const out = host.cachedPageOutline("Alpha");
  assert.equal(fake.pullLog.length, 0, "a hit does not pull either");
  assert.equal(out.exists, true);
  assert.equal(out.uid, "pgAlpha01");
  assert.deepEqual(out.blocks.map((b) => b.string), ["first row", "folded row", "row after the fold"]);
  assert.equal(out.blocks[0].children[0].string, "nested row");
  assert.equal(out.blocks[1].open, false);
  assert.equal(out.blocks[1].kids, 300, "a folded block keeps its child count");
  assert.deepEqual(out.blocks[1].children, [], "and not its 300 children, which would use up the rows after it");
  assert.equal(host.cachedPageOutline("Beta").blocks[0].string, "beta row");
  assert.deepEqual(host.cachedPageOutline("Empty"), { uid: "pgEmpty01", exists: true, blocks: [] }, "a cached page with no children");
  assert.equal(host.cachedPageOutline("Gamma"), null, "a page that is not a card on the board");
});

// A big board (or a keep-alive catch-up) reads its refs in idle slices after the open: the cache is cold until they land.
test("PXD-4 host: on a deferred ref read, cachedPageOutline is null until the idle read lands, and never reads Roam", async () => {
  const queued = [];
  const previous = globalThis.requestIdleCallback;
  globalThis.requestIdleCallback = (fn) => { queued.push(fn); return queued.length; };
  try {
    const { fake, host } = seededHost();
    host.pullBoard("board0001", { light: true, deferRefs: true });
    fake.pullLog = [];
    assert.equal(host.cachedPageOutline("Alpha"), null, "the open returned before the ref read");
    assert.equal(fake.pullLog.length, 0, "and the miss did not read the page");
    // A slice that ran long owes the shared background budget a duty-cycle gap: the next one is armed by a timer.
    const end = Date.now() + 5000;
    while (!host.cachedPageOutline("Beta") && Date.now() < end) {
      if (queued.length) queued.shift()({ timeRemaining: () => 50, didTimeout: false });
      else await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(host.cachedPageOutline("Alpha").blocks[0].string, "first row");
    assert.equal(host.cachedPageOutline("Alpha").blocks[1].kids, 300);
    assert.equal(host.cachedPageOutline("Beta").blocks[0].string, "beta row");
  } finally {
    globalThis.requestIdleCallback = previous;
  }
});

test("PXD-4 host: cachedPageOutline stops at the row limit", () => {
  const { host } = seededHost();
  host.pullBoard("board0001");
  const out = host.cachedPageOutline("Alpha", 2);
  assert.deepEqual(out.blocks.map((b) => b.string), ["first row"]);
  assert.equal(out.blocks[0].children.length, 1);
});

const seed = (title) => ({
  uid: `uid-${title}`,
  exists: true,
  blocks: [
    { uid: "rowA00001", string: "**type:** #Concept", children: [] },
    { uid: "rowB00001", string: "Cronobacter is the flagship pathogen for [[PIF]]", children: [
      { uid: "rowC00001", string: "child row", children: [] },
    ] },
    { uid: "rowD00001", string: "folded block", open: false, kids: 12, children: [] },
  ],
});

function renderer(flags, { cached = seed } = {}) {
  noteSpeedFlags(flags);
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const root = doc.createElement("div");
  root.className = "pxd-root";
  const itemsLayer = doc.createElement("div");
  const sectionsLayer = doc.createElement("div");
  root.append(sectionsLayer, itemsLayer);
  doc.body.append(root);
  const idleQueue = [];
  let roamRoots = 0;
  const reads = { outline: 0, cached: [] };
  const outline = (title) => {
    reads.outline += 1;
    return { uid: `uid-${title}`, exists: true, blocks: [{ uid: "liveRow01", string: "live mounted row", children: [] }] };
  };
  const host = {
    renderString(node, string) { roamRoots += 1; node.textContent = string; },
    renderBlock(node) { node.textContent = "x"; },
    unmount() {},
    blockString: () => "",
    pullTree: () => [],
    pageUid: (t) => `uid-${t}`,
    watchPage: () => () => {},
    pageOutline: outline,
    pagePreview: outline,
    cachedPageOutline: (title, limit) => { reads.cached.push([title, limit]); return cached ? cached(title) : null; },
  };
  const r = createItemRenderer({
    doc, host, session: {}, itemsLayer, sectionsLayer,
    timers: {
      idle(fn) { idleQueue.push(fn); return () => {}; },
      later() { return () => {}; },
      bgRun() { return () => {}; },
    },
  });
  const flush = () => { let guard = 0; while (idleQueue.length && guard++ < 50) idleQueue.shift()({ timeRemaining: () => 10 }); };
  const done = () => { restore(); noteSpeedFlags(null); };
  return { r, flush, done, itemsLayer, reads, roamRoots: () => roamRoots };
}

const board = buildBoard({
  ":block/uid": "boardz0001", ":block/string": "{{[[diagram]]:Z}}", ":block/props": { ":plexus": { ":v": 2 } },
  ":block/children": [{ ":block/uid": "cardPG001", ":block/string": "[[Cronobacter]]", ":block/order": 0, ":block/props": { ":plexus": { ":x": 0, ":y": 0, ":w": 260, ":h": 240 } }, ":block/children": [] }],
});
const wide = { x: -100, y: -100, w: 4000, h: 3000 };

// A new session opens the board at overview: no page card has mounted at detail, so nothing was painted yet.
function firstZoomIn(flags, opts) {
  const t = renderer(flags, opts);
  t.r.sync({ board, rects: worldRects(board), structural: true });
  t.r.setLod("overview", 0.08);
  t.r.scheduleContent({ visibleRect: wide, zoom: 0.08, tier: "overview" });
  t.flush();
  const body = t.itemsLayer.querySelector("[data-uid=cardPG001] .pxd-item__body");
  assert.equal(body.textContent.trim(), "", "overview: no page body");
  const roots = t.roamRoots();
  t.r.setLod("detail", 1);
  return { t, body, roots };
}

test("PXD-4: the first zoom-in of a session paints the cached page rows (plain, no Roam read, no Roam root); the mount replaces them", () => {
  const { t, body, roots } = firstZoomIn(null);
  try {
    const preview = body.querySelector(".pxd-item__page--preview");
    assert.ok(preview, "rows on the first detail frame, not an empty box");
    assert.match(preview.textContent, /flagship pathogen/);
    assert.match(preview.textContent, /child row/);
    assert.match(preview.textContent, /folded block/);
    const rows = [...preview.querySelectorAll(".pxd-prow")];
    const folded = rows.find((row) => /folded block/.test(row.textContent));
    assert.ok(folded.querySelector(".pxd-row__fold"), "a folded block keeps its caret");
    assert.equal(folded.querySelector(".pxd-block__children"), null, "and shows no children");
    assert.equal(preview.querySelector("[data-pxd-row]"), null, "preview rows are not arrow targets");
    assert.equal(t.reads.outline, 0, "the flip reads no page outline");
    assert.deepEqual(t.reads.cached.map(([title]) => title), ["Cronobacter"]);
    assert.equal(t.roamRoots(), roots, "the preview mounts no Roam root");
    t.r.scheduleContent({ visibleRect: wide, zoom: 1, tier: "detail" });
    t.flush();
    assert.equal(body.querySelector(".pxd-item__page--preview"), null, "the mount replaces the preview");
    assert.match(body.textContent, /live mounted row/);
  } finally {
    t.done();
  }
});

test("PXD-4: a page the board read has not cached yet stays an empty box until the content pass (no Roam read at the flip)", () => {
  const { t, body } = firstZoomIn(null, { cached: null });
  try {
    assert.equal(body.querySelector(".pxd-item__page--preview"), null);
    assert.equal(body.textContent.trim(), "");
    assert.equal(t.reads.outline, 0);
  } finally {
    t.done();
  }
});

test("PXD-4: a flip before the deferred ref read lands stays empty; the next content pass paints the rows before the mount", () => {
  let warm = false;
  const { t, body } = firstZoomIn(null, { cached: (title) => (warm ? seed(title) : null) });
  try {
    assert.equal(body.textContent.trim(), "", "cold cache at the flip: no rows, and no Roam read");
    assert.equal(t.reads.outline, 0);
    warm = true;
    t.r.scheduleContent({ visibleRect: wide, zoom: 1, tier: "detail" });
    assert.ok(body.querySelector(".pxd-item__page--preview"), "the content pass paints the cached rows at once");
    assert.match(body.textContent, /flagship pathogen/);
    assert.equal(t.reads.outline, 0, "before any outline read");
    t.flush();
    assert.equal(body.querySelector(".pxd-item__page--preview"), null);
    assert.match(body.textContent, /live mounted row/);
  } finally {
    t.done();
  }
});

test("PXD-4: a cached page with no children previews as \"Empty page\", as it mounts", () => {
  const { t, body } = firstZoomIn(null, { cached: (title) => ({ uid: `uid-${title}`, exists: true, blocks: [] }) });
  try {
    const preview = body.querySelector(".pxd-item__page--preview");
    assert.ok(preview);
    assert.equal(preview.querySelector(".pxd-item__placeholder")?.textContent, "Empty page");
    assert.equal(preview.querySelectorAll(".pxd-prow").length, 0);
  } finally {
    t.done();
  }
});

test("PXD-4: seedRows off keeps the 3.37.0 first zoom-in (empty body, the cache is not asked)", () => {
  const { t, body } = firstZoomIn({ seedRows: false });
  try {
    assert.equal(body.querySelector(".pxd-item__page--preview"), null);
    assert.equal(body.textContent.trim(), "");
    assert.equal(t.reads.cached.length, 0);
  } finally {
    t.done();
  }
});

test("PXD-4: steadyRows off turns the seeded preview off too", () => {
  const { t, body } = firstZoomIn({ steadyRows: false });
  try {
    assert.equal(body.querySelector(".pxd-item__page--preview"), null);
    assert.equal(t.reads.cached.length, 0);
  } finally {
    t.done();
  }
});
