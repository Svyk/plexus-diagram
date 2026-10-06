import assert from "node:assert/strict";
import test from "node:test";

import { createBoardChips } from "../src/boardchips.js";
import { createCardChips } from "../src/cardchips.js";
import { createHost } from "../src/host/roam.js";
import { createCardCache } from "../src/model/card-cache.js";
import { buildBoard, worldRects } from "../src/model/board.js";
import { createPrefetch } from "../src/prefetch.js";
import { createItemRenderer } from "../src/view/cards.js";
import { createChrome } from "../src/view/chrome.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";

function blockBox(doc, uid, { highlight = false } = {}) {
  const container = doc.createElement("div");
  container.className = "roam-block-container";
  container.setAttribute("data-block-uid", uid);
  const main = doc.createElement("div");
  main.className = "rm-block-main";
  if (highlight) {
    const view = doc.createElement("span");
    view.className = "rm-block-highlight-view";
    main.append(view);
  }
  const kids = doc.createElement("div");
  kids.className = "rm-block-children";
  container.append(main, kids);
  return container;
}

// Manual clock and timer queue. Tests never sleep the 80 ms delay.
function clocked(extra = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const calls = [];
  const delays = [];
  const queue = [];
  let seq = 0;
  let clock = 0;
  const cache = extra.cache || createCardCache();
  const prefetch = createPrefetch({
    doc: stub.document,
    cache,
    warm(uid) {
      calls.push(uid);
      return extra.warm?.(uid);
    },
    delayMs: 80,
    now: () => clock,
    enabled: extra.enabled,
    isWarm: extra.isWarm,
    refBoards: extra.refBoards,
    pageBoards: extra.pageBoards,
    setTimer(fn, ms) {
      delays.push(ms);
      const id = ++seq;
      queue.push({ id, fn });
      return id;
    },
    clearTimer(id) {
      const i = queue.findIndex((t) => t.id === id);
      if (i >= 0) queue.splice(i, 1);
    },
  });
  return {
    stub,
    doc: stub.document,
    calls,
    delays,
    queue,
    cache,
    prefetch,
    setClock(n) { clock = n; },
    flush() {
      const batch = queue.splice(0, queue.length);
      for (const t of batch) t.fn();
    },
    done() {
      prefetch.dispose();
      restore();
    },
  };
}

// data.pull is bound inside createHost, so the counter has to wrap it first.
function openHost() {
  const fake = createFakeRoam();
  let apiPulls = 0;
  const orig = fake.api.data.pull.bind(fake.api.data);
  fake.api.data.pull = (pattern, entity) => {
    apiPulls += 1;
    const node = orig(pattern, entity);
    if (node && typeof node === "object" && !Array.isArray(node) && node[":block/uid"]) node[":edit/time"] = 111;
    return node;
  };
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  const pulls = [];
  const pullBoard = host.pullBoard.bind(host);
  host.pullBoard = (uid) => {
    pulls.push(uid);
    return pullBoard(uid);
  };
  return { fake, host, pulls, apiPulls: () => apiPulls };
}

function hostPrefetch(env, extra = {}) {
  return clocked({
    ...extra,
    warm: (uid) => env.host.prefetchBoard(uid),
    isWarm: (uid) => env.host.prefetchBoard.warm(uid) === true,
    refBoards: (uid) => env.host.prefetchBoard.refBoards(uid),
    pageBoards: (title) => env.host.prefetchBoard.pageBoards(title),
  });
}

test("a card chip hovered 80 ms calls pullBoard once, and a leave before that calls it zero times", () => {
  const env = openHost();
  const h = hostPrefetch(env);
  const chips = createCardChips({ doc: h.doc, cache: h.cache, onOpen() {}, onPreview: () => null });
  try {
    env.fake.seedBoard({ uid: "boardA", props: { marker: 7 } });
    h.cache.setBoard("boardA", "A", [{ uid: "card1", target: "block1" }]);
    const root = h.doc.createElement("div");
    const box = blockBox(h.doc, "block1");
    root.append(box);
    h.doc.body.append(root);
    chips.scan(root);
    const chip = box.querySelector(".pxd-cardchip");
    assert.equal(chip.getAttribute("data-board"), "boardA");

    h.stub.dispatch(chip, "pointerover", { relatedTarget: h.doc.body });
    assert.equal(h.delays.at(-1), 80);
    assert.equal(h.queue.length, 1);
    h.flush();
    assert.deepEqual(env.pulls, ["boardA"]);
    assert.equal(h.prefetch.misses(), 1);
    assert.ok(env.apiPulls() > 0);
    const spent = env.apiPulls();

    h.stub.dispatch(chip, "pointerover", { relatedTarget: h.doc.body });
    h.flush();
    assert.equal(h.prefetch.misses(), 1, "a cache hit does not increment the prefetch count");
    assert.deepEqual(env.pulls, ["boardA"]);
    assert.equal(env.apiPulls(), spent);

    const queued = h.delays.length;
    h.stub.dispatch(chip, "pointerover", { relatedTarget: h.doc.body });
    h.stub.dispatch(chip, "pointerout", { relatedTarget: h.doc.body });
    assert.equal(h.queue.length, 0);
    h.flush();
    assert.equal(h.delays.length, queued + 1);
    assert.deepEqual(env.pulls, ["boardA"]);
    assert.equal(env.apiPulls(), spent);
    assert.deepEqual(env.fake.props("boardA"), { marker: 7 });
    assert.deepEqual(env.fake.writesLog(), []);
  } finally {
    chips.dispose();
    h.done();
  }
});

test("a cache hit does not increment the prefetch count", () => {
  const h = clocked();
  try {
    h.cache.rememberBlock("hot", { ":block/uid": "hot" });
    h.prefetch.schedule(["hot"]);
    h.flush();
    assert.deepEqual(h.calls, ["hot"]);
    assert.equal(h.prefetch.misses(), 0);
    h.prefetch.schedule(["c1", "c2", "c3", "c4", "c5"]);
    h.flush();
    assert.deepEqual(h.calls, ["hot", "c1", "c2", "c3", "c4"]);
    assert.equal(h.prefetch.misses(), 4);
  } finally {
    h.done();
  }
});

test("five cache misses inside 60 s call pullBoard four times, and the fifth does not call the data API", () => {
  const env = openHost();
  const h = hostPrefetch(env);
  try {
    for (const uid of ["m1", "m2", "m3", "m4", "m5"]) env.fake.seedBoard({ uid });
    for (const uid of ["m1", "m2", "m3", "m4", "m5"]) {
      const before = env.apiPulls();
      h.prefetch.schedule([uid]);
      assert.equal(h.delays.at(-1), 80);
      h.flush();
      if (uid === "m5") {
        assert.equal(env.apiPulls(), before);
        assert.equal(env.pulls.includes("m5"), false);
      } else {
        assert.ok(env.apiPulls() > before);
        assert.equal(env.pulls.filter((id) => id === uid).length, 1);
      }
    }
    assert.deepEqual(env.pulls, ["m1", "m2", "m3", "m4"]);
    assert.equal(h.prefetch.misses(), 4);
    assert.deepEqual(env.fake.writesLog(), []);
    assert.equal(env.host.stats.writes, 0);
    assert.equal(env.fake.watchCount(), 0);

    h.setClock(60000);
    const before = env.apiPulls();
    h.prefetch.schedule(["m5"]);
    h.flush();
    assert.equal(env.pulls.at(-1), "m5");
    assert.ok(env.apiPulls() > before);
    assert.equal(h.prefetch.misses(), 1);
  } finally {
    h.done();
  }
});

test("a page ref whose title is absent from pageBoardsOf produces zero calls", () => {
  const env = openHost();
  const h = clocked();
  try {
    assert.deepEqual(env.host.prefetchBoard.pageBoards("Missing title"), []);
    const missing = h.doc.createElement("span");
    missing.className = "rm-page-ref";
    missing.setAttribute("data-link-title", "Missing title");
    missing.textContent = "Missing title";
    h.doc.body.append(missing);
    h.stub.dispatch(missing, "pointerover", { relatedTarget: null });
    h.flush();
    assert.deepEqual(h.calls, []);
    assert.equal(h.prefetch.misses(), 0);
    assert.deepEqual(env.pulls, []);

    const bare = h.doc.createElement("span");
    bare.className = "rm-page-ref";
    bare.textContent = "Only text";
    h.doc.body.append(bare);
    h.stub.dispatch(bare, "pointerover", { relatedTarget: null });
    h.flush();
    assert.deepEqual(h.calls, []);

    h.cache.notePageBoard("Known", "boardK");
    const known = h.doc.createElement("span");
    known.className = "rm-page-ref";
    known.setAttribute("data-page-title", "Known");
    h.doc.body.append(known);
    h.stub.dispatch(known, "pointerover", { relatedTarget: null });
    h.flush();
    assert.deepEqual(h.calls, ["boardK"]);
  } finally {
    h.done();
  }
});

test("prefetchBoard reads without writing, watching, or moving :edit/time", () => {
  const env = openHost();
  try {
    env.fake.seedBoard({ uid: "b1", props: { marker: 7 } });
    env.fake.seedBoard({ uid: "parent", children: [{ uid: "c1", string: "note" }] });
    const node = env.host.prefetchBoard("b1");
    assert.equal(node[":block/uid"], "b1");
    assert.equal(node[":edit/time"], 111);
    assert.deepEqual(env.fake.props("b1"), { marker: 7 });
    assert.deepEqual(env.fake.writesLog(), []);
    assert.equal(env.host.stats.writes, 0);
    assert.equal(env.fake.watchCount(), 0);
    assert.equal(env.host.stats.watches, 0);
    const spent = env.apiPulls();
    const again = env.host.prefetchBoard("b1");
    assert.equal(again, node);
    assert.equal(again[":edit/time"], 111);
    assert.equal(env.apiPulls(), spent);
    assert.equal(env.host.prefetchBoard(""), null);
    assert.equal(env.apiPulls(), spent);

    env.host.pullBoard("parent");
    const afterParent = env.apiPulls();
    const child = env.host.prefetchBoard("c1");
    assert.equal(child[":block/uid"], "c1");
    const root = env.host.prefetchBoard("parent");
    assert.equal(root[":block/uid"], "parent");
    assert.equal(root[":edit/time"], 111);
    assert.equal(env.apiPulls(), afterParent);
    assert.equal(env.host.prefetchBoard.warm("missing"), false);
    assert.deepEqual(env.host.prefetchBoard.refBoards("missing"), []);
    assert.deepEqual(env.host.prefetchBoard.pageBoards("missing"), []);
    assert.deepEqual(env.fake.writesLog(), []);
  } finally {
    // openHost does not install a document listener.
  }
});

test("an On board chip warms boardsOf for its block, and a leave cancels", () => {
  const h = clocked();
  try {
    h.cache.setBoard("b1", "One", [{ uid: "c1", target: "hid" }]);
    h.cache.setBoard("b2", "Two", [{ uid: "c2", target: "hid" }]);
    const layer = createBoardChips({ doc: h.doc, cache: h.cache });
    const root = h.doc.createElement("div");
    const box = blockBox(h.doc, "hid", { highlight: true });
    root.append(box);
    h.doc.body.append(root);
    layer.scan(root);
    const chip = box.querySelector(".pxd-boardchip");
    assert.equal(chip.getAttribute("data-block-uid"), "hid");
    h.stub.dispatch(chip, "pointerover", { relatedTarget: h.doc.body });
    assert.equal(h.delays.at(-1), 80);
    h.flush();
    assert.deepEqual(h.calls, ["b1", "b2"]);
    assert.equal(h.prefetch.misses(), 2);

    h.calls.length = 0;
    h.stub.dispatch(chip, "pointerover", { relatedTarget: h.doc.body });
    h.stub.dispatch(chip, "pointerout", { relatedTarget: h.doc.body });
    h.flush();
    assert.deepEqual(h.calls, []);
    layer.dispose();
  } finally {
    h.done();
  }
});

test("a breadcrumb warms its board and the current crumb does not", () => {
  const h = clocked();
  try {
    const root = h.doc.createElement("div");
    root.className = "pxd-root";
    h.doc.body.append(root);
    const chrome = createChrome({
      doc: h.doc,
      root,
      version: "2.17.0",
      settings: {},
      timers: { later: () => () => {}, frame: () => () => {} },
      crumbs: [
        { uid: "rootB", title: "Root" },
        { uid: "curB", title: "Current" },
      ],
    });
    const button = root.querySelector(".pxd-btn.pxd-crumb");
    const current = root.querySelector(".pxd-crumb--current");
    assert.equal(button.getAttribute("data-board"), "rootB");
    assert.equal(current.getAttribute("data-board"), null);
    h.stub.dispatch(current, "pointerover", { relatedTarget: root });
    h.flush();
    assert.deepEqual(h.calls, []);
    h.stub.dispatch(button, "pointerover", { relatedTarget: root });
    h.flush();
    assert.deepEqual(h.calls, ["rootB"]);
    h.calls.length = 0;
    h.stub.dispatch(button, "pointerover", { relatedTarget: root });
    h.stub.dispatch(button, "pointerout", { relatedTarget: root });
    h.flush();
    assert.deepEqual(h.calls, []);
    chrome.dispose();
  } finally {
    h.done();
  }
});

test("a block ref warms only boards the cache already knows", () => {
  const h = clocked();
  try {
    h.cache.setBoard("boardB", "B", [{ uid: "cardB", target: "ref1" }]);
    const known = h.doc.createElement("span");
    known.className = "rm-block-ref";
    known.setAttribute("data-uid", "ref1");
    h.doc.body.append(known);
    h.stub.dispatch(known, "pointerover", { relatedTarget: null });
    h.flush();
    assert.deepEqual(h.calls, ["boardB"]);
    assert.equal(h.calls.includes("ref1"), false);

    const unknown = h.doc.createElement("span");
    unknown.className = "rm-block-ref";
    unknown.setAttribute("data-uid", "nope");
    h.doc.body.append(unknown);
    const n = h.calls.length;
    h.stub.dispatch(unknown, "pointerover", { relatedTarget: null });
    h.flush();
    assert.equal(h.calls.length, n);
    assert.equal(h.calls.includes("nope"), false);
  } finally {
    h.done();
  }
});

test("a nested board card hover warms that board through the document listener, with no per-board listener", () => {
  const h = clocked();
  try {
    const root = h.doc.createElement("div");
    root.className = "pxd-root";
    const itemsLayer = h.doc.createElement("div");
    const sectionsLayer = h.doc.createElement("div");
    root.append(sectionsLayer, itemsLayer);
    h.doc.body.append(root);
    const overBefore = itemsLayer.listeners?.get("pointerover")?.size || 0;
    const host = {
      stats: {},
      renderString(node, string) { node.textContent = string; },
      renderBlock(node, uid) { node.textContent = uid; },
      unmount() {},
      blockString: () => null,
      pullTree: () => [],
      pullBoard: () => null,
      pagePreview: () => ({ exists: false, blocks: [] }),
    };
    const timers = {
      idle() { return () => {}; },
      frame() { return () => {}; },
      later() { return () => {}; },
    };
    const r = createItemRenderer({ doc: h.doc, host, session: {}, itemsLayer, sectionsLayer, timers });
    const raw = {
      ":block/uid": "board0001",
      ":block/string": "{{[[diagram]]:Test}}",
      ":block/props": { ":plexus": { ":v": 2 } },
      ":block/children": [{
        ":block/uid": "nest0001",
        ":block/string": "{{[[diagram]]}}",
        ":block/order": 0,
        ":block/props": { ":plexus": { x: 40, y: 40, w: 220, h: 160 } },
        ":block/children": [],
      }],
    };
    const board = buildBoard(raw);
    r.sync({ board, rects: worldRects(board), dirty: null, structural: true });
    const card = itemsLayer.querySelector(".pxd-item--board");
    assert.ok(card);
    assert.equal(card.getAttribute("data-uid"), "nest0001");
    assert.equal(itemsLayer.listeners?.get("pointerover")?.size || 0, overBefore, "the renderer adds no hover listener of its own");
    h.stub.dispatch(card, "pointerover", { relatedTarget: root });
    assert.equal(h.delays.at(-1), 80);
    h.flush();
    assert.deepEqual(h.calls, ["nest0001"]);
    h.calls.length = 0;
    h.stub.dispatch(card, "pointerover", { relatedTarget: root });
    h.stub.dispatch(card, "pointerout", { relatedTarget: root });
    h.flush();
    assert.deepEqual(h.calls, []);
    r.dispose();
    assert.equal(itemsLayer.listeners?.get("pointerover")?.size || 0, overBefore);
  } finally {
    h.done();
  }
});

test("prefetch stays off when enabled is false, and only one warm is in flight", async () => {
  let on = false;
  let release = () => {};
  const h = clocked({
    enabled: () => on,
    warm() {
      return new Promise((resolve) => { release = resolve; });
    },
  });
  try {
    h.prefetch.schedule(["x"]);
    h.flush();
    assert.deepEqual(h.calls, []);
    on = true;
    h.prefetch.schedule(["a"]);
    h.flush();
    assert.deepEqual(h.calls, ["a"]);
    h.prefetch.schedule(["b"]);
    h.flush();
    assert.deepEqual(h.calls, ["a"]);
    release();
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    assert.deepEqual(h.calls, ["a", "b"]);
  } finally {
    h.done();
  }
});
