// B4-C wiring. Fake DOM and host only. Live Roam stays with the parent.
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { buildMenu, flattenMenu } from "../src/view/menu-model.js";
import { mountBoardView } from "../src/view/board-view.js";
import { createItemRenderer } from "../src/view/cards.js";
import { openHaloPopover } from "../src/view/halo-pop.js";
import { DRAWING_STRING } from "../src/model/drawing-card.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";

afterEach(() => resetSessions());

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const DAY = 86400000;
const AREA = "{{[[plexus-region]]: k=area d=ITvT3bqaL ids=pmm-3NChDbxPu-h6dynpr9M pad=10}} ((h6dynpr9M))";
const VISIBLE = { x: 0, y: 0, w: 1000, h: 800 };

const idsOf = (menu) => flattenMenu(menu).map((item) => item.id);
const checkedOf = (menu) => flattenMenu(menu).filter((item) => item.checked).map((item) => item.id);
const rowFor = (root, id) => [...root.querySelectorAll(".pxd-menu__item")].find((node) => node.getAttribute("data-id") === id);

function pulled() {
  const item = (uid, string, plexus, order, children = []) => ({
    ":block/uid": uid,
    ":block/string": string,
    ":block/order": order,
    ":block/props": plexus ? { ":plexus": plexus } : {},
    ":block/children": children,
  });
  return {
    ":block/uid": "board0001",
    ":block/string": "{{[[diagram]]:Test}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": [
      item("cardAAAA1", "Alpha\nbody line", { ":x": 0, ":y": 0, ":w": 200, ":h": 100 }, 0),
      item("cardBBBB2", "[[Beta]]", { ":x": 300, ":y": 0, ":w": 200, ":h": 100 }, 1),
      item("cardFAR03", "Far away", { ":x": 4000, ":y": 0, ":w": 200, ":h": 100 }, 2),
      item("cardFAR04", "Also far", { ":x": 0, ":y": 3000, ":w": 200, ":h": 100 }, 3),
      item("textTTTT5", "Label", { ":type": "text", ":x": 100, ":y": 200, ":w": 240, ":h": 48 }, 4),
      item("sectCCCC3", "[[Evidence]]", { ":type": "section", ":x": 0, ":y": 300, ":w": 400, ":h": 300 }, 5, [
        item("cardDDDD4", "Inside", { ":x": 20, ":y": 60, ":w": 200, ":h": 100 }, 0),
      ]),
      item("edgesEEE5", "Connections", { ":type": "edges" }, 6, [
        item("edgeFFFF6", "((cardAAAA1)) → causes → [[Beta]]", { ":type": "edge", ":from": "cardAAAA1", ":to": "cardBBBB2" }, 0),
      ]),
    ],
  };
}

function fakeSession(board) {
  const handlers = new Map();
  const mutations = [];
  const rec = (name) => (...args) => { mutations.push([name, ...args]); return Promise.resolve(`${name}-uid`); };
  const session = {
    uid: board.uid,
    board,
    rects: worldRects(board),
    links: [],
    coveredEdges: new Set(),
    busy: false,
    mutations,
    on(name, fn) {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name).add(fn);
      return () => handlers.get(name).delete(fn);
    },
    emit(name, payload) { for (const fn of [...(handlers.get(name) || [])]) fn(payload); },
    release() {},
    setLinkMode() {},
    commitMove: rec("commitMove"),
    commitRects: rec("commitRects"),
    createCard: rec("createCard"),
    createText: rec("createText"),
    createSection: rec("createSection"),
    deleteItems: rec("deleteItems"),
    setColor: rec("setColor"),
    setCollapsed: rec("setCollapsed"),
    setPinned: rec("setPinned"),
    setFit: rec("setFit"),
    addEdge: rec("addEdge"),
    updateEdge: rec("updateEdge"),
    undo: rec("undo"),
    redo: rec("redo"),
    layoutByDate(...args) {
      mutations.push(["layoutByDate", ...args]);
      return Promise.resolve(0);
    },
  };
  return session;
}

function mountView({ rows = [], q } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const bag = { queries: [], opens: [] };
  const board = buildBoard(pulled());
  const session = fakeSession(board);
  const host = {
    graph: "Svy",
    calls: {},
    renderString(el, string) { el.textContent = string; },
    renderBlock(el) {
      const input = el.ownerDocument.createElement("textarea");
      input.className = "rm-block__input";
      el.append(input);
    },
    renderPage() {},
    unmount() {},
    pagePreview: () => ({ uid: "pg", exists: true, blocks: [] }),
    pullTree: () => [],
    blockString: () => null,
    pageUid: () => "pgBeta001",
    openBlock() {},
    openInSidebar(...args) { bag.opens.push(args); },
    searchPages: () => [],
    searchBlocks: () => [],
    related: () => [],
    cardStringForUid: (uid) => `((${uid}))`,
    q(query, ...args) {
      bag.queries.push({ query: String(query), args });
      if (typeof q === "function") return q(String(query), ...args);
      return rows;
    },
  };
  const mountEl = stub.document.createElement("div");
  stub.document.body.append(mountEl);
  const view = mountBoardView({
    host,
    session,
    mountEl,
    settings: { get: () => undefined },
    version: "1.0.0",
  });
  const flush = async () => {
    stub.flushFrames();
    await tick();
    stub.flushIdle();
    stub.flushFrames();
  };
  return { stub, restore, board, session, host, view, bag, flush };
}

async function settle(stub) {
  for (let i = 0; i < 6; i += 1) {
    await tick();
    stub.flushFrames();
    stub.flushIdle();
  }
}

const timelineQueries = (bag) => bag.queries.filter((row) => row.query.includes("re-pattern"));

test("timeline query runs once on Info open and never at mount", async () => {
  const f = mountView();
  try {
    await f.flush();
    assert.equal(f.view.root.querySelector(".pxd-timeline"), null);
    assert.equal(timelineQueries(f.bag).length, 0);
    const before = f.session.mutations.length;
    f.view.root.querySelector(".pxd-toolbar__info").click();
    await settle(f.stub);
    const hits = timelineQueries(f.bag);
    assert.equal(hits.length, 1);
    const ids = hits[0].args[0];
    assert.ok(ids.includes("board0001"));
    assert.ok(ids.includes("pgBeta001"));
    assert.ok(ids.includes("cardAAAA1"));
    assert.ok(ids.includes("cardDDDD4"));
    assert.equal(ids.includes("Beta"), false);
    assert.equal(ids.includes("textTTTT5"), false);
    assert.equal(ids.includes("sectCCCC3"), false);
    f.view.root.querySelector(".pxd-toolbar__info").click();
    await settle(f.stub);
    assert.equal(timelineQueries(f.bag).length, 1, "the board cache answers the second open");
    assert.equal(f.session.mutations.length, before, "viewing the timeline writes nothing");
    const section = f.view.root.querySelector(".pxd-panel__info-sec .pxd-timeline")?.parentElement;
    assert.ok(section);
    assert.equal(section.querySelector(".pxd-panel__info-h"), null);
    assert.equal(section.querySelector("button"), null, "an empty timeline has no buttons");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("a selected card opens Info through addInfoTab and still queries once", async () => {
  const f = mountView();
  try {
    await f.flush();
    f.view.controller.select(["cardAAAA1"]);
    f.view.root.querySelector(".pxd-toolbar__info").click();
    await settle(f.stub);
    assert.equal(timelineQueries(f.bag).length, 1);
    assert.equal(f.session.mutations.length, 0);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("Show on board pulses the card and Open day uses the sidebar", async () => {
  const row = ["pgBeta001", "ref000001", "October 6th, 2026", "daypage01", 1_700_000_000_000];
  const f = mountView({ rows: [row] });
  try {
    await f.flush();
    f.view.root.querySelector(".pxd-toolbar__info").click();
    await settle(f.stub);
    const show = f.view.root.querySelector(".pxd-timeline__show");
    assert.ok(show);
    show.click();
    const pulsed = [...f.view.root.querySelectorAll(".pxd-item--pulse")].map((el) => el.getAttribute("data-uid"));
    assert.ok(pulsed.includes("cardBBBB2"));
    f.view.root.querySelector(".pxd-timeline__open").click();
    assert.deepEqual(f.bag.opens.at(-1), ["daypage01", "block"]);
    assert.equal(f.session.mutations.length, 0);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("lens toggles write nothing and dust paints an age", async () => {
  const f = mountView({
    q(query, ids) {
      if (query.includes("get-else") && !query.includes("re-pattern")) {
        const old = Date.now() - 400 * DAY;
        return (ids || []).map((id) => [id, old, old]);
      }
      return [];
    },
  });
  try {
    await f.flush();
    const before = f.session.mutations.length;
    f.view.root.querySelector(".pxd-toolbar__more").click();
    rowFor(f.view.root, "lens-strength").click();
    await settle(f.stub);
    f.view.root.querySelector(".pxd-toolbar__more").click();
    rowFor(f.view.root, "lens-dust:6 months").click();
    await settle(f.stub);
    assert.equal(f.session.mutations.length, before);
    const dusty = [...f.view.root.querySelectorAll(".pxd-item[data-uid]")].some((el) => el.getAttribute("data-dust-age") === "1 year");
    assert.equal(dusty, true);
    assert.ok(f.bag.queries.some((row) => row.query.includes(":block/refs") && row.query.includes("count")));
    assert.equal(timelineQueries(f.bag).length, 0);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("date source is view state until Lay out by date", async () => {
  const f = mountView();
  try {
    await f.flush();
    const title = f.view.root.querySelector(".pxd-section__title");
    f.stub.dispatch(title, "contextmenu", { button: 2, clientX: 20, clientY: 20 });
    rowFor(f.view.root, "layout-dates").click();
    await settle(f.stub);
    const attribute = f.session.mutations.filter((row) => row[0] === "layoutByDate");
    assert.equal(attribute.length, 1);
    assert.equal(attribute[0][1], "sectCCCC3");
    assert.equal(attribute[0][2].mode, "attribute");
    assert.equal(timelineQueries(f.bag).length, 0);
    f.stub.dispatch(title, "contextmenu", { button: 2, clientX: 20, clientY: 20 });
    rowFor(f.view.root, "date-source:first").click();
    await settle(f.stub);
    assert.equal(f.session.mutations.filter((row) => row[0] === "layoutByDate").length, 1);
    assert.equal(timelineQueries(f.bag).length, 0);
    f.stub.dispatch(title, "contextmenu", { button: 2, clientX: 20, clientY: 20 });
    rowFor(f.view.root, "layout-dates").click();
    await settle(f.stub);
    const mention = f.session.mutations.filter((row) => row[0] === "layoutByDate");
    assert.equal(mention.length, 2);
    assert.equal(mention[1][2].mode, "first");
    assert.ok(Array.isArray(mention[1][2].rows));
    assert.equal(timelineQueries(f.bag).length, 1, "first mention with an empty cache queries once");
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("menu model hides Compass when interop is off and keeps lens rows behind a flag", () => {
  const compassOn = idsOf(buildMenu("card", { compass: true }));
  assert.equal(compassOn[compassOn.indexOf("open-sidebar") + 1], "open-compass");
  assert.equal(idsOf(buildMenu("card", { compass: true, interop: false })).includes("open-compass"), false);
  assert.equal(idsOf(buildMenu("board-menu", {})).includes("lens-strength"), false);
  const lens = buildMenu("board-menu", { lens: true, strength: true, dust: "1 year" });
  assert.ok(idsOf(lens).includes("lens-strength"));
  assert.ok(checkedOf(lens).includes("lens-strength"));
  assert.ok(checkedOf(lens).includes("lens-dust:1 year"));
  assert.ok(checkedOf(buildMenu("section", {})).includes("date-source:attribute"));
  assert.ok(checkedOf(buildMenu("section", { dateSource: "first" })).includes("date-source:first"));
  assert.ok(checkedOf(buildMenu("section", { dateSource: "last" })).includes("date-source:last"));
});

test("halo popover shows the dust age without a button", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const opened = openHaloPopover({ doc: stub.document, dustAge: "1 year", model: {} });
    const pop = stub.document.querySelector(".pxd-halo");
    assert.equal(pop.getAttribute("data-dust-age"), "1 year");
    const dust = pop.querySelector(".pxd-halo__dust");
    assert.equal(dust.tagName, "DIV");
    assert.equal(dust.textContent, "1 year");
    opened.close();
    const plain = openHaloPopover({ doc: stub.document, model: {} });
    assert.equal(stub.document.querySelector(".pxd-halo").hasAttribute("data-dust-age"), false);
    plain.close();
  } finally {
    restore();
  }
});

function placed(uid) {
  const block = fake.block(uid);
  return block?.props?.plexus || {};
}

let fake;

async function datedBoard(children) {
  fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({
    uid: "board0001",
    props: { plexus: { v: 2 } },
    children: [
      {
        uid: "sect0001",
        string: "Week",
        props: { plexus: { type: "section", x: 0, y: 0, w: 900, h: 500 } },
        children,
      },
    ],
  });
  const session = acquireSession("board0001", { host, linkDelay: 0 });
  fake.clearLog();
  return session;
}

test("layoutByDate keeps the day column and skips a card with no date", async () => {
  const session = await datedBoard([
    { uid: "cardday01", string: "[[October 6th, 2026]]", props: { plexus: { x: 4, y: 4, w: 200, h: 80 } } },
    { uid: "cardplain", string: "no date here", props: { plexus: { x: 4, y: 4, w: 200, h: 80 } } },
  ]);
  const n = await session.layoutByDate("sect0001");
  assert.equal(n, 1);
  assert.equal(placed("cardday01").x, 156);
  assert.equal(placed("cardday01").y, 48);
  assert.equal(placed("cardplain").x, 4);
  assert.equal(fake.writesLog().length, 1);
  fake.clearLog();
  const again = await session.layoutByDate("sect0001", "attribute");
  assert.equal(again, 1);
  assert.equal(fake.writesLog().length, 1);
});

test("first mention places a dateless card and skips a dated card with no row", async () => {
  const session = await datedBoard([
    { uid: "cardplain", string: "no date here", props: { plexus: { x: 4, y: 4, w: 200, h: 80 } } },
    { uid: "cardday01", string: "[[October 6th, 2026]]", props: { plexus: { x: 4, y: 4, w: 200, h: 80 } } },
  ]);
  const rows = [["cardplain", "ref000001", "October 6th, 2026", "daypage01", 10]];
  const n = await session.layoutByDate("sect0001", { mode: "first", rows });
  assert.equal(n, 1);
  assert.equal(placed("cardplain").x, 156);
  assert.equal(placed("cardplain").y, 48);
  assert.equal(placed("cardday01").x, 4);
  assert.equal(fake.writesLog().length, 1);
});

test("layoutByDate stops at 45 writes", async () => {
  const children = [];
  for (let i = 0; i < 50; i += 1) {
    const uid = `c${String(i).padStart(2, "0")}`;
    children.push({ uid, string: "Date:: 2026-10-06", props: { plexus: { x: 4, y: 4, w: 80, h: 40 } } });
  }
  const session = await datedBoard(children);
  const n = await session.layoutByDate("sect0001", { mode: "attribute", rows: [] });
  assert.equal(n, 45);
  assert.equal(fake.writesLog().length, 45);
  assert.equal(placed("c00").x, 156);
  assert.equal(placed("c44").x, 156);
  assert.equal(placed("c45").x, 4);
});

function card(uid, string, order) {
  return {
    ":block/uid": uid,
    ":block/string": string,
    ":block/order": order,
    ":block/props": { ":plexus": { ":x": 16, ":y": 16 + order * 20, ":w": 220, ":h": 120 } },
    ":block/children": [],
  };
}

function renderer({ children, resolve, interopOn, hostExtra = {} }) {
  const stub = createDomStub();
  const restore = stub.install();
  const thumbs = [];
  const api = {
    apiVersion: 7,
    thumbnail(uid, opts) {
      thumbs.push({ uid, opts });
      return null;
    },
    regionsOf: () => [],
  };
  stub.window.RoamPlexus = api;
  globalThis.RoamPlexus = api;
  const doc = stub.document;
  const root = doc.createElement("div");
  root.className = "pxd-root";
  const itemsLayer = doc.createElement("div");
  const sectionsLayer = doc.createElement("div");
  root.append(sectionsLayer, itemsLayer);
  doc.body.append(root);
  const idleQueue = [];
  const frameQueue = [];
  const timers = {
    idle(fn) {
      idleQueue.push(fn);
      return () => {
        const i = idleQueue.indexOf(fn);
        if (i >= 0) idleQueue.splice(i, 1);
      };
    },
    frame(fn) {
      frameQueue.push(fn);
      return () => {
        const i = frameQueue.indexOf(fn);
        if (i >= 0) frameQueue.splice(i, 1);
      };
    },
    later(fn, ms) {
      const timer = setTimeout(fn, ms || 0);
      return () => clearTimeout(timer);
    },
  };
  const writes = [];
  const r = createItemRenderer({
    doc,
    host: {
      stats: {},
      renderString(node, string) { node.textContent = string; },
      unmount() {},
      blockString: () => null,
      pullTree: () => [],
      pullBoard: () => null,
      pagePreview: () => ({ exists: false, blocks: [] }),
      pageTitleOf: () => "",
      pageUid: () => "",
      openInSidebar() {},
      ...hostExtra,
    },
    session: { props(...args) { writes.push(args); } },
    itemsLayer,
    sectionsLayer,
    timers,
    ...(interopOn ? { interopOn } : {}),
  });
  const board = buildBoard({
    ":block/uid": "board0001",
    ":block/string": "{{[[diagram]]:Test}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": children,
  }, { resolve, plexusApi: { apiVersion: 7 } });
  r.sync({ board, rects: worldRects(board), dirty: null, structural: true });
  const pump = () => {
    let guard = 0;
    while ((idleQueue.length || frameQueue.length) && guard < 40) {
      if (idleQueue.length) idleQueue.shift()({ timeRemaining: () => 100 });
      else frameQueue.shift()();
      guard += 1;
    }
  };
  const show = (dirty) => {
    r.scheduleContent({ visibleRect: VISIBLE, zoom: 1, tier: "detail", ...(dirty === undefined ? {} : { dirty }) });
    pump();
  };
  return {
    stub, r, board, thumbs, writes, idleQueue, show,
    done() {
      r.dispose();
      restore();
      delete stub.window.RoamPlexus;
      delete globalThis.RoamPlexus;
    },
  };
}

test("interop off hides Roam Plexus thumbnails and the default still calls them", async () => {
  const children = [
    card("drawcard1", "((draw00001))", 0),
    card("regioncd1", "((reg000001))", 1),
  ];
  const resolve = (uid) => (uid === "draw00001" ? DRAWING_STRING : uid === "reg000001" ? AREA : null);
  const off = renderer({ children, resolve, interopOn: () => false });
  try {
    assert.equal(off.board.items.get("drawcard1").kind, "drawing-ref");
    assert.equal(off.board.items.get("regioncd1").kind, "region-ref");
    off.show();
    await tick();
    await tick();
    assert.equal(off.thumbs.length, 0);
  } finally {
    off.done();
  }
  const on = renderer({ children, resolve });
  try {
    on.show();
    await tick();
    await tick();
    assert.ok(on.thumbs.length > 0);
  } finally {
    on.done();
  }
});

test("source chip is only for Articles and Media Captures blocks and follows the author", async () => {
  let author = "Ada Lovelace";
  const titles = [];
  const pulls = [];
  const opens = [];
  const titleOf = {
    artblock1: "Articles/On chalk",
    artblock2: "Articles/On chalk",
    mediablk1: "Media Captures/Clip",
    inboxblk1: "Inbox",
  };
  const blockText = {
    boardref1: "{{[[diagram]]:Inner}}",
    queryref1: "{{[[query]]}}",
  };
  const s = renderer({
    children: [
      card("artcard01", "((artblock1))", 0),
      card("artcard02", "((artblock2))", 1),
      card("medcard01", "((mediablk1))", 2),
      card("inboxcd1", "((inboxblk1))", 3),
      card("boardrf1", "((boardref1))", 4),
      card("queryrf1", "((queryref1))", 5),
      card("querycd1", "{{[[query]]}}", 6),
      card("boardcd1", "{{[[diagram]]:Inner}}", 7),
      card("pdfcard1", "{{[[pdf]]:file}}", 8),
      card("notecard1", "plain note", 9),
    ],
    hostExtra: {
      blockString: (uid) => blockText[uid] ?? "A line of the source.",
      pageTitleOf(uid) {
        titles.push(uid);
        return titleOf[uid] || "";
      },
      pageUid(title) {
        if (title === "Articles/On chalk") return "pageArt01";
        if (title === "Media Captures/Clip") return "pageMed01";
        return "";
      },
      pullTree(uid) {
        pulls.push(uid);
        if (uid === "pageArt01") return [{ ":block/string": `Author:: [[${author}]]` }];
        return [];
      },
      openInSidebar(...args) { opens.push(args); },
    },
  });
  try {
    s.show();
    const chip = (uid) => s.r.shellOf(uid)?.querySelector(".pxd-chip--source") || null;
    assert.match(chip("artcard01").textContent, /Articles\/On chalk/);
    assert.match(chip("artcard01").textContent, /Ada Lovelace/);
    assert.match(chip("artcard02").textContent, /Ada Lovelace/);
    assert.equal(chip("medcard01").textContent, "Media Captures/Clip");
    for (const uid of ["inboxcd1", "boardrf1", "queryrf1", "querycd1", "boardcd1", "pdfcard1", "notecard1"]) {
      assert.equal(chip(uid), null, uid);
    }
    assert.equal(pulls.filter((uid) => uid === "pageArt01").length, 1);
    assert.equal(pulls.filter((uid) => uid === "pageMed01").length, 1);
    assert.equal(titles.includes("boardref1"), false);
    assert.equal(titles.includes("queryref1"), false);
    assert.equal(titles.includes("notecard1"), false);
    assert.equal(s.writes.length, 0);
    chip("artcard01").click();
    assert.deepEqual(opens.at(-1), ["pageArt01"]);
    author = "Grace Hopper";
    s.r.sync({ board: s.board, rects: worldRects(s.board), dirty: new Set(["artcard01"]) });
    s.show(new Set(["artcard01"]));
    await tick();
    assert.match(s.r.shellOf("artcard01").querySelector(".pxd-chip--source").textContent, /Grace Hopper/);
    assert.equal(pulls.filter((uid) => uid === "pageArt01").length, 2);
    assert.equal(s.writes.length, 0);
  } finally {
    s.done();
  }
});
