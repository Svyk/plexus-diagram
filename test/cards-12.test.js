import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { mock } from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { createItemRenderer } from "../src/view/cards.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const blk = (uid, string, plexus, order, children = []) => ({
  ":block/uid": uid,
  ":block/string": string,
  ":block/order": order,
  ":block/props": plexus ? { ":plexus": plexus } : {},
  ":block/children": children,
});

const rawBoard = (children) => ({
  ":block/uid": "board0001",
  ":block/string": "{{[[diagram]]:Test}}",
  ":block/props": { ":plexus": { ":v": 2 } },
  ":block/children": children,
});

const visible = { x: -10000, y: -10000, w: 20000, h: 20000 };

function harness({ children, hostOverrides = {}, rendererOptions = {} } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const calls = { renderString: 0, opened: [], badge: [] };
  const host = {
    renderString(node, string) { calls.renderString += 1; node.textContent = string; },
    unmount() {},
    blockString: () => null,
    pullTree: () => [],
    pullBoard: () => null,
    pagePreview: () => ({ exists: false, blocks: [] }),
    ...hostOverrides,
  };
  const itemsLayer = doc.createElement("div");
  const sectionsLayer = doc.createElement("div");
  doc.body.append(sectionsLayer);
  doc.body.append(itemsLayer);
  const idleQueue = [];
  const laterQueue = [];
  const timers = {
    idle(fn) { idleQueue.push(fn); return () => { const i = idleQueue.indexOf(fn); if (i >= 0) idleQueue.splice(i, 1); }; },
    later(fn, ms) { const t = { fn, ms }; laterQueue.push(t); return () => { const i = laterQueue.indexOf(t); if (i >= 0) laterQueue.splice(i, 1); }; },
  };
  const r = createItemRenderer({
    doc,
    host,
    session: {},
    itemsLayer,
    sectionsLayer,
    timers,
    onOpenBoard: (uid) => calls.opened.push(uid),
    onBadgeClick: (uid, kind) => calls.badge.push([uid, kind]),
    ...rendererOptions,
  });
  let board = null;
  let rects = null;
  const load = (raw, { dirty = null, structural = true } = {}) => {
    board = buildBoard(raw);
    rects = worldRects(board);
    r.sync({ board, rects, dirty, structural });
    return board;
  };
  load(rawBoard(children));
  const flush = () => {
    let guard = 0;
    while (idleQueue.length && guard++ < 50) idleQueue.shift()({ timeRemaining: () => 10, didTimeout: false });
  };
  const show = (tier = "detail", zoom = tier === "detail" ? 1 : 0.3) => {
    r.setLod(tier, zoom);
    r.scheduleContent({ visibleRect: visible, zoom, tier });
    flush();
  };
  return {
    stub, doc, host, calls, r, laterQueue, load, flush, show, itemsLayer, sectionsLayer,
    get board() { return board; },
    get rects() { return rects; },
    shell: (uid) => r.shellOf(uid),
    done() { r.dispose(); restore(); },
  };
}

const CARD = { ":x": 0, ":y": 0, ":w": 200, ":h": 100 };

const mixedChildren = () => [
  blk("cardAAAA1", "Alpha\nbody", CARD, 0),
  blk("textTTTT5", "Label", { ":type": "text", ":x": 100, ":y": 200, ":w": 240, ":h": 48 }, 1),
  blk("sectCCCC3", "[[Evidence]]", { ":type": "section", ":x": 0, ":y": 300, ":w": 400, ":h": 300 }, 2, [
    blk("cardDDDD4", "Inside", { ":x": 20, ":y": 60, ":w": 200, ":h": 100 }, 0),
  ]),
  blk("nbCard001", "{{[[diagram]]:Roadmap}}", { ":x": 500, ":y": 300, ":w": 320, ":h": 220, ":v": 2 }, 3, [
    blk("kidNB0001", "one", { ":x": 0, ":y": 0, ":w": 100, ":h": 50, ":color": "teal" }, 0),
    blk("kidNB0002", "two", { ":x": 200, ":y": 100, ":w": 100, ":h": 50 }, 1),
  ]),
];

test("quiet drops live Roam roots while typing elsewhere and mounts them again after", () => {
  const h = harness({ children: mixedChildren() });
  try {
    h.show("detail");
    const before = h.calls.renderString;
    assert.ok(before > 0);
    let unmounts = 0;
    h.host.unmount = () => { unmounts += 1; };
    h.r.quiet(true);
    assert.ok(!h.r.mountedUids().includes("cardAAAA1"));
    assert.ok(unmounts > 0);
    assert.match(h.shell("cardAAAA1").textContent, /Alpha/);
    assert.ok(h.shell("cardAAAA1").querySelector(".pxd-quiet"));
    const mid = h.calls.renderString;
    h.show("detail");
    assert.equal(h.calls.renderString, mid, "a quiet board does not remount on schedule");
    h.r.quiet(false);
    h.flush();
    assert.ok(h.calls.renderString > mid);
    assert.ok(h.r.mountedUids().includes("cardAAAA1"));
  } finally {
    h.done();
  }
});

test("LOD tiers: map and overview mount section titles, text and board shells only; detail mounts cards", () => {
  const h = harness({ children: mixedChildren() });
  try {
    h.show("detail");
    assert.deepEqual(new Set(h.r.mountedUids()), new Set(["cardAAAA1", "textTTTT5", "sectCCCC3", "cardDDDD4", "nbCard001"]));
    assert.equal(h.r.lod(), "detail");
    for (const tier of ["map", "overview"]) {
      const fresh = harness({ children: mixedChildren() });
      try {
        fresh.show(tier);
        assert.equal(fresh.r.lod(), tier);
        assert.deepEqual(new Set(fresh.r.mountedUids()), new Set(["textTTTT5", "sectCCCC3", "nbCard001"]), `${tier}: headings and board thumbnails only`);
        assert.ok(fresh.shell("nbCard001").querySelector(".pxd-mini"), `${tier}: the board thumbnail is mounted`);
        assert.equal(fresh.shell("cardAAAA1").querySelector(".pxd-item__body").children.length, 0, `${tier}: card bodies stay empty`);
      } finally {
        fresh.done();
      }
    }
  } finally {
    h.done();
  }
});

test("LOD tiers: an unknown tier name falls back to detail", () => {
  const h = harness({ children: mixedChildren() });
  try {
    h.r.setLod("bogus", 1);
    assert.equal(h.r.lod(), "detail");
    h.r.setLod("overview", 0.1);
    assert.equal(h.r.lod(), "overview");
  } finally {
    h.done();
  }
});

test("header text is capped: ref title at 120 characters, header text at 160", () => {
  const long = "x".repeat(500);
  const h = harness({
    children: [
      blk("refCARD01", "((longUid001))", CARD, 0),
      blk("noteCARD1", `${"y".repeat(400)}`, { ":x": 300, ":y": 0, ":w": 200, ":h": 100 }, 1),
    ],
    hostOverrides: { blockString: (uid) => (uid === "longUid001" ? long : null) },
  });
  try {
    h.show("detail");
    assert.equal(h.shell("refCARD01").querySelector(".pxd-item__header").textContent.length, 120);
    assert.equal(h.shell("noteCARD1").querySelector(".pxd-item__header").textContent.length, 160);
  } finally {
    h.done();
  }
});

test("pxd-item--bare marks a card whose body is empty or unmounted, and clears on mount", () => {
  const clock = { t: 1000 };
  const nowMock = mock.method(globalThis.performance, "now", () => clock.t);
  const h = harness({ children: mixedChildren() });
  try {
    assert.ok(h.shell("cardAAAA1").classList.contains("pxd-item--bare"), "a new card shell starts bare");
    assert.equal(h.shell("textTTTT5").classList.contains("pxd-item--bare"), false, "only card shells are bare");
    assert.equal(h.shell("sectCCCC3").classList.contains("pxd-item--bare"), false);
    h.show("detail");
    assert.equal(h.shell("cardAAAA1").classList.contains("pxd-item--bare"), false, "mounted content clears bare");
    // a content change under a mounted card unmounts it again
    const raw = rawBoard(mixedChildren());
    raw[":block/children"][0][":block/string"] = "Alpha changed";
    h.load(raw, { dirty: new Set(["cardAAAA1"]), structural: false });
    assert.ok(h.shell("cardAAAA1").classList.contains("pxd-item--bare"), "a content change leaves the body empty and the header visible");
    h.show("detail");
    assert.equal(h.shell("cardAAAA1").classList.contains("pxd-item--bare"), false);
    // a map switch unmounts card bodies after the grace period and they turn bare again
    h.show("map");
    clock.t += 10000;
    for (const t of [...h.laterQueue]) t.fn();
    assert.ok(h.shell("cardAAAA1").classList.contains("pxd-item--bare"), "unmountContent sets bare");
    assert.equal(h.shell("cardAAAA1").querySelector(".pxd-item__body").children.length, 0);
    // a repaint of the dirty shell keeps the class
    h.load(rawBoard(mixedChildren()), { dirty: new Set(["cardAAAA1"]), structural: false });
    assert.ok(h.shell("cardAAAA1").classList.contains("pxd-item--bare"));
  } finally {
    h.done();
    nowMock.mock.restore();
  }
});

test("board thumbnail: titled minis, one edges svg of hairlines, no accent-soft, sections as frames", () => {
  const children = [
    blk("nbCard001", "{{[[diagram]]:Roadmap}}", { ":x": 0, ":y": 0, ":w": 320, ":h": 220, ":v": 2 }, 0, [
      blk("kidSECT01", "[[Phase one]]", { ":type": "section", ":x": 0, ":y": 0, ":w": 400, ":h": 200 }, 0, [
        blk("kidIN0001", "inside a section", { ":x": 20, ":y": 50, ":w": 120, ":h": 60 }, 0),
      ]),
      blk("kidNB0001", "one", { ":x": 500, ":y": 0, ":w": 4, ":h": 50, ":color": "teal" }, 1),
      blk("kidNB0002", "two", { ":x": 700, ":y": 100, ":w": 100, ":h": 50 }, 2),
      blk("kidEDGES1", "Connections", { ":type": "edges" }, 3, [
        blk("kidEDGE01", "((kidNB0001)) → ((kidNB0002))", { ":type": "edge", ":from": "kidNB0001", ":to": "kidNB0002" }, 0),
      ]),
    ]),
    blk("nbEmpty01", "{{[[diagram]]:Nothing yet}}", { ":x": 600, ":y": 0, ":w": 320, ":h": 220, ":v": 2 }, 1),
  ];
  const h = harness({ children });
  try {
    h.show("detail");
    const card = h.shell("nbCard001");
    const canvas = card.querySelector(".pxd-board-preview__canvas");
    assert.ok(canvas);
    assert.equal(canvas.style.aspectRatio, undefined, "the canvas fills the holder instead of setting an aspect box");
    const minis = card.querySelectorAll(".pxd-mini");
    assert.equal(minis.length, 4);
    const titled = card.querySelectorAll(".pxd-mini__title").map((n) => n.textContent);
    assert.ok(titled.includes("one") && titled.includes("two") && titled.includes("inside a section"));
    const section = card.querySelector(".pxd-mini.pxd-mini--section");
    assert.equal(section.querySelector(".pxd-mini__title").textContent, "Phase one", "a section frame carries a title strip");
    const tiny = card.querySelector(".pxd-mini.pxd-c-teal");
    assert.ok(tiny.classList.contains("pxd-mini--tiny"), "a mini under 28px wide is marked so CSS hides its title");
    const order = canvas.children.map((n) => (n.classList.contains("pxd-mini--section") ? "section" : n.classList.contains("pxd-mini") ? "mini" : "edges"));
    assert.deepEqual(order, ["section", "edges", "mini", "mini", "mini"], "section frames, then hairlines, then cards on top");
    const svgs = card.querySelectorAll(".pxd-board-preview__edges");
    assert.equal(svgs.length, 1, "one svg for every connection");
    assert.equal(svgs[0].getAttribute("viewBox"), "0 0 1 1");
    assert.equal(svgs[0].getAttribute("preserveAspectRatio"), "none");
    assert.equal(svgs[0].querySelectorAll("line").length, 1);
    assert.equal(card.querySelector(".pxd-board-preview").className.includes("accent-soft"), false);
    assert.equal(card.querySelector(".pxd-item__board-count").textContent, "4 items");
    const empty = h.shell("nbEmpty01");
    assert.equal(empty.querySelector(".pxd-board-preview__empty").textContent, "Empty board");
    assert.equal(empty.querySelector(".pxd-mini"), null);
    assert.equal(empty.querySelector(".pxd-board-preview__edges"), null);
    const css = readFileSync(new URL("../src/extension.css", import.meta.url), "utf8");
    const at = css.indexOf(".pxd-board-preview {");
    assert.doesNotMatch(css.slice(at, css.indexOf("}", at)), /accent-soft/, "the holder paints the surface with a dot pattern, not accent bars");
  } finally {
    h.done();
  }
});

test("board thumbnail: resizing the board card remounts it (the content key includes w and h)", () => {
  const make = (w) => [blk("nbCard001", "{{[[diagram]]:Roadmap}}", { ":x": 0, ":y": 0, ":w": w, ":h": 220, ":v": 2 }, 0, [
    blk("kidNB0001", "one", { ":x": 0, ":y": 0, ":w": 100, ":h": 50 }, 0),
  ])];
  const h = harness({ children: make(320) });
  try {
    h.show("detail");
    const before = h.shell("nbCard001").querySelector(".pxd-board-preview");
    h.load(rawBoard(make(480)), { dirty: new Set(["nbCard001"]), structural: false });
    h.show("detail");
    const after = h.shell("nbCard001").querySelector(".pxd-board-preview");
    assert.ok(after && after !== before, "the preview was rebuilt for the new size");
  } finally {
    h.done();
  }
});

test("whiteboard shortcut: a block-ref card to a board draws the same thumbnail and never calls renderString", () => {
  const pulled = {
    ":block/uid": "wbTarget1",
    ":block/string": "{{[[diagram]]:Whiteboard}}",
    ":block/children": [
      blk("wbKid0001", "first", { ":x": 0, ":y": 0, ":w": 100, ":h": 50 }, 0),
      blk("wbKid0002", "second", { ":x": 200, ":y": 100, ":w": 100, ":h": 50 }, 1),
    ],
  };
  const h = harness({
    children: [blk("refWB0001", "((wbTarget1))", { ":x": 0, ":y": 0, ":w": 320, ":h": 220 }, 0)],
    hostOverrides: {
      blockString: (uid) => (uid === "wbTarget1" ? "{{[[diagram]]:Whiteboard}}" : null),
      pullBoard: (uid) => (uid === "wbTarget1" ? pulled : null),
    },
  });
  try {
    h.show("detail");
    const card = h.shell("refWB0001");
    assert.equal(h.calls.renderString, 0, "no nested overlay: renderString is never called for a board ref");
    assert.ok(card.classList.contains("pxd-item--wb"));
    assert.equal(card.querySelector(".pxd-item__header").textContent, "Whiteboard");
    assert.equal(card.querySelectorAll(".pxd-mini").length, 2);
    assert.equal(card.querySelector(".pxd-item__board-name"), null, "a shortcut never offers a rename field");
    card.querySelector(".pxd-item__open").click();
    assert.deepEqual(h.calls.opened, ["wbTarget1"], "Open navigates to the referenced board");
    assert.equal(h.calls.renderString, 0);
  } finally {
    h.done();
  }
});

test("whiteboard shortcut: the thumbnail is mounted at map and overview zoom, and survives the unmount sweep", () => {
  const pulled = {
    ":block/uid": "wbTarget1",
    ":block/string": "{{[[diagram]]:Whiteboard}}",
    ":block/children": [blk("wbKid0001", "first", { ":x": 0, ":y": 0, ":w": 100, ":h": 50 }, 0)],
  };
  const h = harness({
    children: [
      blk("refWB0001", "((wbTarget1))", CARD, 0),
      blk("refPLAIN1", "((plainUid1))", { ":x": 300, ":y": 0, ":w": 200, ":h": 100 }, 1),
    ],
    hostOverrides: {
      blockString: (uid) => (uid === "wbTarget1" ? "{{[[diagram]]:Whiteboard}}" : uid === "plainUid1" ? "plain text" : null),
      pullBoard: (uid) => (uid === "wbTarget1" ? pulled : null),
    },
  });
  try {
    for (const tier of ["map", "overview"]) {
      h.show(tier);
      assert.equal(h.shell("refWB0001").querySelectorAll(".pxd-mini").length, 1, `${tier}: the shortcut shows its thumbnail on first paint`);
      assert.equal(h.shell("refPLAIN1").querySelector(".pxd-item__string"), null, `${tier}: a plain ref card stays title-only`);
    }
    for (const t of h.laterQueue.splice(0)) t.fn();
    assert.equal(h.shell("refWB0001").querySelectorAll(".pxd-mini").length, 1, "the unmount sweep keeps the shortcut thumbnail");
  } finally {
    h.done();
  }
});

test("whiteboard shortcut: a missing target shows the empty state; a plain block ref still renders its string", () => {
  const h = harness({
    children: [
      blk("refWB0001", "((wbGone001))", CARD, 0),
      blk("refPLAIN1", "((plainUid1))", { ":x": 300, ":y": 0, ":w": 200, ":h": 100 }, 1),
    ],
    hostOverrides: {
      blockString: (uid) => (uid === "wbGone001" ? "{{[[diagram]]:Gone}}" : uid === "plainUid1" ? "plain text" : null),
    },
  });
  try {
    h.show("detail");
    assert.equal(h.shell("refWB0001").querySelector(".pxd-board-preview__empty").textContent, "Empty board");
    assert.equal(h.shell("refPLAIN1").classList.contains("pxd-item--wb"), false);
    assert.equal(h.calls.renderString, 1, "only the plain ref goes through renderString");
  } finally {
    h.done();
  }
});

test("previewSectionRects positions only the listed section shells; resetRects restores model rects", () => {
  const h = harness({ children: mixedChildren() });
  try {
    const section = h.shell("sectCCCC3");
    const card = h.shell("cardAAAA1");
    const cardTransform = card.style.transform;
    const live = h.r.previewSectionRects([
      { uid: "sectCCCC3", x: 10, y: 20, w: 500, h: 400 },
      { uid: "cardAAAA1", x: 999, y: 999, w: 10, h: 10 },
      { uid: "nope", x: 0, y: 0, w: 1, h: 1 },
    ]);
    assert.ok(live instanceof Map);
    assert.deepEqual([...live.keys()], ["sectCCCC3"], "cards and unknown uids are ignored");
    assert.equal(section.style.transform, "translate(10px, 20px)");
    assert.equal(section.style.width, "500px");
    assert.equal(section.style.height, "400px");
    assert.equal(card.style.transform, cardTransform, "the card shell was not touched");
    h.r.resetRects(h.rects, ["sectCCCC3"]);
    const model = h.rects.get("sectCCCC3");
    assert.equal(section.style.transform, `translate(${model.x}px, ${model.y}px)`);
    assert.equal(section.style.width, `${model.w}px`);
    assert.equal(section.style.height, `${model.h}px`);
  } finally {
    h.done();
  }
});

test("measureContent reads the natural content height, not the clamped box, so Fit height can shrink", () => {
  const h = harness({ children: mixedChildren() });
  try {
    h.show("detail");
    const card = h.shell("cardAAAA1");
    const body = card.querySelector(".pxd-item__body");
    body.style.flex = "1 1 auto";
    body.style.height = "";
    // A fixed-height flex column clamps scrollHeight to the box (398) until the body may take its natural height.
    Object.defineProperty(body, "scrollHeight", { configurable: true, get: () => (body.style.flex === "0 0 auto" && body.style.height === "auto" ? 90 : 398) });
    card.querySelector(".pxd-item__header")._rect = { left: 0, top: 0, width: 200, height: 32, right: 200, bottom: 32, x: 0, y: 0 };
    assert.equal(h.r.measureContent("cardAAAA1"), 122, "header + natural body, far below the 398 box");
    assert.equal(body.style.flex, "1 1 auto", "the inline styles are put back");
    assert.equal(body.style.height, "");
  } finally {
    h.done();
  }
});

test("board thumbnails title ref cards from the referenced block and image cards by kind", () => {
  const h = harness({
    children: [
      blk("nbCard001", "{{[[diagram]]:Inner}}", { ":x": 0, ":y": 0, ":w": 320, ":h": 220, ":v": 2 }, 0, [
        blk("innerRef1", "((refTarget1))", { ":x": 0, ":y": 0, ":w": 100, ":h": 50 }, 0),
        blk("innerImg1", "![](https://files.test/a.png)", { ":x": 200, ":y": 100, ":w": 100, ":h": 50 }, 1),
      ]),
    ],
    hostOverrides: { blockString: (uid) => (uid === "refTarget1" ? "Target text\nsecond line" : null) },
  });
  try {
    h.show("detail");
    const titles = h.shell("nbCard001").querySelectorAll(".pxd-mini__title").map((t) => t.textContent);
    assert.deepEqual(titles.sort(), ["Image", "Target text"]);
  } finally {
    h.done();
  }
});

test("measureContent returns the world-unit content height, or null when not mounted or not at detail", () => {
  const h = harness({ children: mixedChildren() });
  try {
    assert.equal(h.r.measureContent("cardAAAA1"), null, "not mounted yet");
    h.show("detail");
    const card = h.shell("cardAAAA1");
    assert.equal(h.r.measureContent("cardAAAA1"), null, "nothing laid out in the stub");
    card.querySelector(".pxd-item__body").scrollHeight = 180;
    card.querySelector(".pxd-item__header")._rect = { left: 0, top: 0, width: 200, height: 32, right: 200, bottom: 32, x: 0, y: 0 };
    assert.equal(h.r.measureContent("cardAAAA1"), 212);
    assert.equal(h.r.measureContent("sectCCCC3"), null, "sections have no card content");
    assert.equal(h.r.measureContent("missing"), null);
    h.r.setLod("map", 0.3);
    assert.equal(h.r.measureContent("cardAAAA1"), null, "not measurable outside detail");
  } finally {
    h.done();
  }
});

test("badges: refs / boards / todo chips, up to three attribute chips, hidden off-detail and when off", () => {
  const children = [
    blk("cardAAAA1", "Task card\nStatus:: open\nOwner:: [[Lori]]", CARD, 0, [
      blk("kidATTR01", "Due:: today", null, 0),
      blk("kidATTR02", "Priority:: high", null, 1),
      blk("kidPLAIN1", "no attribute here", null, 2),
    ]),
    blk("cardBBBB2", "Bare card", { ":x": 300, ":y": 0, ":w": 200, ":h": 100 }, 1),
  ];
  const h = harness({ children });
  try {
    const snapshot = JSON.stringify([...h.board.items.entries()]);
    h.show("detail");
    assert.equal(h.shell("cardAAAA1").querySelector(".pxd-item__badges"), null, "badges are off by default");
    h.r.setBadges(new Map([["cardAAAA1", { refs: 3, boards: 2, open: 2, done: 5 }]]));
    assert.equal(h.shell("cardAAAA1").querySelector(".pxd-item__badges"), null, "still off until enabled");
    h.r.setShowBadges(true);
    const row = h.shell("cardAAAA1").querySelector(".pxd-item__badges");
    assert.ok(row);
    assert.equal(row.querySelector(".pxd-badge-chip--refs").textContent, "3 refs");
    assert.equal(row.querySelector(".pxd-badge-chip--boards").textContent, "on 2 boards");
    assert.equal(row.querySelector(".pxd-badge-chip--todo").textContent, "2/5");
    const attrs = row.querySelectorAll(".pxd-badge-chip--attr").map((n) => n.textContent);
    assert.deepEqual(attrs, ["Status: open", "Owner: Lori", "Due: today"], "at most three attribute chips, plain text");
    assert.equal(h.shell("cardBBBB2").querySelector(".pxd-item__badges"), null, "a card with nothing to show gets no row");
    row.querySelector(".pxd-badge-chip--boards").click();
    assert.deepEqual(h.calls.badge, [["cardAAAA1", "boards"]]);
    // the same map again does not rebuild the row
    h.r.setBadges(new Map([["cardAAAA1", { refs: 3, boards: 2, open: 2, done: 5 }]]));
    assert.equal(h.shell("cardAAAA1").querySelector(".pxd-item__badges"), row);
    h.r.setBadges(new Map([["cardAAAA1", { refs: 4, boards: 0, open: 0, done: 0 }]]));
    const next = h.shell("cardAAAA1").querySelector(".pxd-item__badges");
    assert.equal(next.querySelector(".pxd-badge-chip--boards"), null);
    assert.equal(next.querySelector(".pxd-badge-chip--refs").textContent, "4 refs");
    h.r.setLod("map", 0.3);
    assert.equal(h.shell("cardAAAA1").querySelector(".pxd-item__badges"), null, "hidden at map");
    h.r.setLod("overview", 0.1);
    assert.equal(h.shell("cardAAAA1").querySelector(".pxd-item__badges"), null, "hidden at overview");
    h.r.setLod("detail", 1);
    assert.ok(h.shell("cardAAAA1").querySelector(".pxd-item__badges"), "back at detail");
    h.r.setShowBadges(false);
    assert.equal(h.shell("cardAAAA1").querySelector(".pxd-item__badges"), null, "hidden when off");
    assert.equal(JSON.stringify([...h.board.items.entries()]), snapshot, "badges never touch the model");
  } finally {
    h.done();
  }
});

test("badges: a block-ref card takes attribute chips from the referenced string; board cards take none", () => {
  const h = harness({
    children: [
      blk("refATTR01", "((attrUid001))", CARD, 0),
      blk("nbCard001", "{{[[diagram]]:Roadmap}}", { ":x": 300, ":y": 0, ":w": 320, ":h": 220, ":v": 2 }, 1, [
        blk("kidNB0001", "Inner:: value", { ":x": 0, ":y": 0, ":w": 100, ":h": 50 }, 0),
      ]),
    ],
    hostOverrides: { blockString: (uid) => (uid === "attrUid001" ? "Title line\nStage:: draft" : null) },
  });
  try {
    h.show("detail");
    h.r.setShowBadges(true);
    const chips = h.shell("refATTR01").querySelectorAll(".pxd-badge-chip--attr").map((n) => n.textContent);
    assert.deepEqual(chips, ["Stage: draft"]);
    assert.equal(h.shell("nbCard001").querySelector(".pxd-item__badges"), null);
  } finally {
    h.done();
  }
});

test("pinned items get the pinned class on cards and sections", () => {
  const h = harness({
    children: [
      blk("cardAAAA1", "Pinned card", { ...CARD, ":pinned": true }, 0),
      blk("cardBBBB2", "Free card", { ":x": 300, ":y": 0, ":w": 200, ":h": 100 }, 1),
      blk("sectPIN01", "[[Pinned section]]", { ":type": "section", ":x": 0, ":y": 300, ":w": 400, ":h": 300, ":pinned": true }, 2),
    ],
  });
  try {
    assert.ok(h.shell("cardAAAA1").classList.contains("pxd-item--pinned"));
    assert.equal(h.shell("cardBBBB2").classList.contains("pxd-item--pinned"), false);
    assert.ok(h.shell("sectPIN01").classList.contains("pxd-section--pinned"));
    assert.equal(h.shell("sectPIN01").classList.contains("pxd-item--pinned"), false);
  } finally {
    h.done();
  }
});

test("setFocus dims shells outside the set with a class only, and clears with null", () => {
  const h = harness({ children: mixedChildren() });
  try {
    const card = h.shell("cardAAAA1");
    const section = h.shell("sectCCCC3");
    const styleBefore = JSON.stringify(card.style);
    h.r.setFocus(new Set(["cardAAAA1"]));
    assert.equal(card.classList.contains("pxd-item--focus-dim"), false, "the focused item stays");
    assert.ok(h.shell("textTTTT5").classList.contains("pxd-item--focus-dim"));
    assert.ok(section.classList.contains("pxd-section--focus-dim"));
    assert.equal(section.classList.contains("pxd-item--focus-dim"), false);
    assert.equal(JSON.stringify(card.style), styleBefore, "zero style writes");
    // a repaint keeps the dim, and a shell painted while focus is active is dimmed too
    h.load(rawBoard(mixedChildren()), { dirty: new Set(["sectCCCC3"]), structural: false });
    assert.ok(section.classList.contains("pxd-section--focus-dim"));
    h.r.setFocus(null);
    for (const uid of ["textTTTT5", "sectCCCC3", "nbCard001"]) {
      const cls = h.shell(uid).className;
      assert.doesNotMatch(cls, /focus-dim/, uid);
    }
  } finally {
    h.done();
  }
});

test("a cold board over 80 cards paints the visible ones first", () => {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const itemsLayer = doc.createElement("div");
  const sectionsLayer = doc.createElement("div");
  doc.body.append(itemsLayer, sectionsLayer);
  const frames = [];
  const timers = {
    idle() { return () => {}; },
    later() { return () => {}; },
    frame(fn) { frames.push(fn); return () => {}; },
  };
  const host = {
    renderString(node, string) { node.textContent = string; },
    unmount() {},
    blockString: () => null,
    pullTree: () => [],
    pullBoard: () => null,
    pagePreview: () => ({ exists: false, blocks: [] }),
  };
  const r = createItemRenderer({ doc, host, session: {}, itemsLayer, sectionsLayer, timers });
  const children = [];
  for (let i = 0; i < 90; i += 1) {
    children.push(blk(`c${String(i).padStart(8, "0")}`, `Card ${i}`, { ":x": i * 400, ":y": 0, ":w": 200, ":h": 100 }, i));
  }
  const board = buildBoard(rawBoard(children));
  const rects = worldRects(board);
  const view = { x: -10, y: -10, w: 220, h: 120 };
  try {
    r.sync({ board, rects, structural: true, view });
    assert.ok(r.shellOf(board.order[0]), "the card in view is painted");
    assert.equal(r.shellOf(board.order[89]), null, "a card outside the view waits");
    assert.ok(frames.length >= 1);
    let guard = 0;
    while (frames.length && guard < 20) {
      guard += 1;
      frames.shift()();
    }
    assert.ok(r.shellOf(board.order[89]), "the rest arrive over later frames");
    assert.equal(itemsLayer.querySelectorAll(".pxd-item").length, 90);
  } finally {
    r.dispose();
    restore();
  }
});

test("a cold board whose camera sees nothing still paints only a first handful", () => {
  const stub = createDomStub();
  const restore = stub.install();
  const doc = stub.document;
  const itemsLayer = doc.createElement("div");
  const sectionsLayer = doc.createElement("div");
  doc.body.append(itemsLayer, sectionsLayer);
  const frames = [];
  const timers = {
    idle() { return () => {}; },
    later() { return () => {}; },
    frame(fn) { frames.push(fn); return () => {}; },
  };
  const host = {
    renderString(node, string) { node.textContent = string; },
    unmount() {},
    blockString: () => null,
    pullTree: () => [],
    pullBoard: () => null,
    pagePreview: () => ({ exists: false, blocks: [] }),
  };
  const r = createItemRenderer({ doc, host, session: {}, itemsLayer, sectionsLayer, timers });
  const children = [];
  for (let i = 0; i < 90; i += 1) {
    children.push(blk(`d${String(i).padStart(8, "0")}`, `Card ${i}`, { ":x": i * 400, ":y": 0, ":w": 200, ":h": 100 }, i));
  }
  const board = buildBoard(rawBoard(children));
  const rects = worldRects(board);
  try {
    r.sync({ board, rects, structural: true, view: { x: 1e9, y: 1e9, w: 100, h: 100 } });
    const painted = board.order.filter((uid) => r.shellOf(uid)).length;
    assert.equal(painted, 24);
    assert.equal(r.shellOf(board.order[0]), null, "the far card waits");
    assert.ok(r.shellOf(board.order[89]), "the card nearest the camera is in the first handful");
    let guard = 0;
    while (frames.length && guard < 20) {
      guard += 1;
      frames.shift()();
    }
    assert.equal(board.order.filter((uid) => r.shellOf(uid)).length, 90);
  } finally {
    r.dispose();
    restore();
  }
});
