// REL-6: a visible ((uid)) card follows an edit to its source. One pull watch per source uid.
import test from "node:test";
import assert from "node:assert/strict";
import { createHost } from "../src/host/roam.js";
import { buildBoard, worldRects } from "../src/model/board.js";
import { createItemRenderer } from "../src/view/cards.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const BLOCK_WATCH = "[:block/string]";

function joinedHost() {
  const board = {
    ":block/uid": "board",
    ":block/string": "{{[[diagram]]}}",
    ":block/props": { plexus: { v: 2 } },
    ":block/children": [{
      ":block/uid": "card",
      ":block/string": "((src01))",
      ":block/order": 0,
      ":block/refs": [{
        ":block/uid": "src01",
        ":block/string": "ref target GAMMA",
        ":block/open": true,
        ":block/children": [],
      }],
    }],
  };
  const pulls = [];
  const watches = [];
  const data = {
    pull(pattern, entity) {
      pulls.push(entity);
      const id = Array.isArray(entity) ? entity[1] : null;
      if (id === "board") return structuredClone(board);
      if (id === "src01") return { ":block/uid": "src01", ":block/string": "ref target DELTA" };
      return null;
    },
    q() { return []; },
    fast: { q() { return []; } },
    addPullWatch(pattern, entity, cb) { watches.push({ pattern, entity, cb }); },
    removePullWatch(pattern, entity, cb) {
      const i = watches.findIndex((w) => w.cb === cb && w.entity === entity && w.pattern === pattern);
      if (i >= 0) watches.splice(i, 1);
    },
  };
  const host = createHost({ api: { data, util: { generateUID: () => "uid" } }, storage: new Map(), graph: "g" });
  const blockWatches = () => watches.filter((w) => w.pattern === BLOCK_WATCH);
  return { host, pulls, blockWatches };
}

test("coversBlock does not suppress the source watch, and two callers share one", () => {
  const { host, pulls, blockWatches } = joinedHost();
  host.pullBoard("board");
  const offBoard = host.watchBoard("board", () => {});
  assert.equal(host.coversBlock("src01"), true);
  assert.equal(host.blockString("src01"), "ref target GAMMA");
  const before = pulls.length;
  const seen = [];
  const offA = host.watchBlock("src01", (got) => seen.push(["a", got[":block/string"]]));
  const offB = host.watchBlock("src01", (got) => seen.push(["b", got[":block/string"]]));
  assert.equal(blockWatches().length, 1);
  assert.equal(pulls.length, before, "arming the source watch does not pull");
  const boardWatches = host.stats.watches;
  assert.equal(boardWatches, 2);
  blockWatches()[0].cb(null, { ":block/string": "ref target DELTA" });
  assert.deepEqual(seen.map((row) => row[0]).sort(), ["a", "b"]);
  assert.equal(host.blockString("src01"), "ref target DELTA");
  assert.equal(pulls.length, before, "the patched cache serves the new string");
  offA();
  assert.equal(blockWatches().length, 1);
  assert.equal(host.stats.watches, 2);
  offB();
  offB();
  assert.equal(blockWatches().length, 0);
  assert.equal(host.stats.watches, 1);
  offBoard();
  assert.equal(host.stats.watches, 0);
});

function cardHarness(children, visible) {
  const stub = createDomStub();
  const restore = stub.install();
  const fake = createFakeRoam();
  fake.seedPage({ uid: "page0001", title: "Notes", children: [{ uid: "src000001", string: "ref target GAMMA" }] });
  const added = [];
  const origAdd = fake.api.data.addPullWatch.bind(fake.api.data);
  fake.api.data.addPullWatch = (pattern, entity, cb) => {
    added.push({ pattern, entity, cb });
    return origAdd(pattern, entity, cb);
  };
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  const doc = stub.document;
  const itemsLayer = doc.createElement("div");
  const sectionsLayer = doc.createElement("div");
  doc.body.append(sectionsLayer, itemsLayer);
  const idleQueue = [];
  const laterQueue = [];
  const timers = {
    idle(fn) { idleQueue.push(fn); return () => { const i = idleQueue.indexOf(fn); if (i >= 0) idleQueue.splice(i, 1); }; },
    later(fn) { const t = { fn }; laterQueue.push(t); return () => { const i = laterQueue.indexOf(t); if (i >= 0) laterQueue.splice(i, 1); }; },
  };
  const raw = {
    ":block/uid": "board0001",
    ":block/string": "{{[[diagram]]}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": children,
  };
  const board = buildBoard(raw);
  const r = createItemRenderer({ doc, host, session: {}, itemsLayer, sectionsLayer, timers });
  r.sync({ board, rects: worldRects(board), dirty: null, structural: true });
  r.setLod("detail", 1);
  r.scheduleContent({ visibleRect: visible, zoom: 1, tier: "detail" });
  let guard = 0;
  while (idleQueue.length && guard++ < 40) idleQueue.shift()({ timeRemaining: () => 1000, didTimeout: false });
  const blockWatches = () => added.filter((w) => w.pattern === BLOCK_WATCH);
  return {
    host, fake, r, board, blockWatches,
    runLater() { const q = laterQueue.splice(0); for (const t of q) t.fn(); },
    shell: (uid) => r.shellOf(uid),
    done() { r.dispose(); restore(); },
  };
}

const card = (uid, x) => ({
  ":block/uid": uid,
  ":block/string": "((src000001))",
  ":block/order": x === 0 ? 0 : 1,
  ":block/props": { ":plexus": { ":x": x, ":y": 0, ":w": 240, ":h": 140 } },
});

const onScreen = { x: -1000, y: -1000, w: 4000, h: 3000 };

test("two visible block-ref cards share one watch and both show the source edit", () => {
  const h = cardHarness([card("card00001", 0), card("card00002", 280)], onScreen);
  try {
    assert.equal(h.board.items.get("card00001").kind, "block");
    assert.equal(h.blockWatches().length, 1);
    assert.equal(h.host.stats.watches, 1);
    assert.equal(h.fake.watchCount(), 1);
    for (const uid of ["card00001", "card00002"]) {
      const el = h.shell(uid);
      assert.match(el.querySelector(".pxd-item__header").textContent, /GAMMA/);
      assert.match(el.querySelector(".pxd-item__string").textContent, /GAMMA/);
    }
    h.blockWatches()[0].cb(null, { ":block/string": "ref target DELTA" });
    assert.match(h.shell("card00001").querySelector(".pxd-item__string").textContent, /GAMMA/);
    h.runLater();
    for (const uid of ["card00001", "card00002"]) {
      const el = h.shell(uid);
      assert.match(el.querySelector(".pxd-item__header").textContent, /DELTA/);
      assert.match(el.querySelector(".pxd-item__string").textContent, /DELTA/);
      assert.doesNotMatch(el.querySelector(".pxd-item__string").textContent, /GAMMA/);
    }
    assert.equal(h.blockWatches().length, 1);
  } finally { h.done(); }
  assert.equal(h.host.stats.watches, 0);
  assert.equal(h.fake.watchCount(), 0);
});

test("a block-ref card off screen keeps its header and adds no watch", () => {
  const h = cardHarness([card("card00001", 0)], { x: 9000, y: 9000, w: 200, h: 200 });
  try {
    const el = h.shell("card00001");
    assert.match(el.querySelector(".pxd-item__header").textContent, /GAMMA/);
    assert.equal(el.querySelector(".pxd-item__string"), null);
    assert.equal(h.blockWatches().length, 0);
    assert.equal(h.host.stats.watches, 0);
  } finally { h.done(); }
});
