import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { closeTab, isBoardTabEvent, openTab, tabAt, tabStorageKey } from "../src/model/tabs.js";
import { createTabStore } from "../src/host/roam.js";
import { SHORTCUTS, findShortcut } from "../src/view/shortcuts.js";
import { createInteractions } from "../src/view/interactions.js";
import { mountBoardView } from "../src/view/board-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

function sessionFor(uid, title) {
  const board = buildBoard({
    ":block/uid": uid,
    ":block/string": `{{[[diagram]]:${title}}}`,
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": [],
  });
  return {
    uid: board.uid,
    board,
    rects: worldRects(board),
    links: [],
    coveredEdges: new Set(),
    on() { return () => {}; },
    release() {},
  };
}

function mount(stub, { uid, title, store, fullscreen = true, onSelectTab, host = {} } = {}) {
  const mountEl = stub.document.createElement("div");
  mountEl.className = "pxd-mount";
  stub.document.body.append(mountEl);
  const deleted = [];
  const view = mountBoardView({
    host: {
      graph: "Notes",
      renderString(el, string) { el.textContent = string; },
      renderBlock() {},
      unmount() {},
      deleteBlock(...args) { deleted.push(args); },
      stats: { writes: 0 },
      ...host,
    },
    session: sessionFor(uid, title),
    mountEl,
    settings: { get: () => undefined },
    fullscreen,
    tabStore: store,
    onSelectTab,
  });
  stub.flushFrames();
  return { view, deleted };
}

function tabsOf(root) {
  return [...root.querySelectorAll(".pxd-fstab")].map((node) => ({
    uid: node.getAttribute("data-uid"),
    on: node.getAttribute("aria-selected") === "true",
    title: node.querySelector(".pxd-fstab__name")?.textContent,
  }));
}

test("HEP-2: openTab keeps order, caps at 9, and close leaves the neighbor", () => {
  let tabs = [];
  for (let i = 1; i <= 10; i += 1) tabs = openTab(tabs, { uid: `b${i}`, title: `Board ${i}` }).tabs;
  assert.equal(tabs.length, 9);
  assert.equal(tabs[0].uid, "b2");
  assert.equal(tabs[8].uid, "b10");
  const again = openTab(tabs, { uid: "b4", title: "Renamed" });
  assert.equal(again.index, tabs.findIndex((t) => t.uid === "b4"));
  assert.equal(again.tabs[again.index].title, "Renamed");
  assert.equal(again.tabs[0].uid, "b2");
  const closed = closeTab(again.tabs, "b4");
  assert.equal(closed.removed, true);
  assert.equal(closed.tabs[closed.index].uid, "b5");
  assert.equal(tabAt(closed.tabs, 99), null);
  assert.equal(isBoardTabEvent({ key: "1", code: "Digit1", meta: true }, 1), true);
  assert.equal(isBoardTabEvent({ key: "!", code: "Digit1", shift: true }, 1), false);
  assert.equal(isBoardTabEvent({ key: "1", code: "Digit1", meta: true, shift: true }, 1), false);
});

test("HEP-2: three boards make three tabs and Cmd+1..3 select them", () => {
  const stub = createDomStub();
  const restore = stub.install();
  const store = createTabStore({ storage: memoryStorage(), graph: "Notes" });
  const picked = [];
  mount(stub, { uid: "boardAAA1", title: "Alpha", store }).view.dispose();
  mount(stub, { uid: "boardBBB2", title: "Beta", store }).view.dispose();
  const { view, deleted } = mount(stub, {
    uid: "boardCCC3",
    title: "Gamma",
    store,
    onSelectTab: (uid) => picked.push(uid),
  });
  const strip = view.root.querySelector(".pxd-fstabs");
  assert.equal(strip.parentElement, view.root);
  assert.equal(stub.document.body.querySelector(":scope > .pxd-fstabs"), null);
  assert.deepEqual(tabsOf(view.root), [
    { uid: "boardAAA1", on: false, title: "Alpha" },
    { uid: "boardBBB2", on: false, title: "Beta" },
    { uid: "boardCCC3", on: true, title: "Gamma" },
  ]);
  assert.equal(view.root.dataset.board, "boardCCC3");

  const key = (extra) => stub.dispatch(stub.window, "keydown", { altKey: false, metaKey: false, ctrlKey: false, shiftKey: false, ...extra });
  key({ key: "1", code: "Digit1", metaKey: true });
  key({ key: "2", code: "Digit2", metaKey: true });
  const beforeThird = picked.length;
  key({ key: "3", code: "Digit3", metaKey: true });
  key({ key: "4", code: "Digit4", metaKey: true });
  assert.deepEqual(picked, ["boardAAA1", "boardBBB2"]);
  assert.equal(picked.length, beforeThird);
  assert.equal(view.root.dataset.board, "boardCCC3");

  const shift = key({ key: "!", code: "Digit1", shiftKey: true });
  assert.equal(shift.defaultPrevented, true);
  assert.deepEqual(picked, ["boardAAA1", "boardBBB2"]);
  assert.deepEqual(deleted, []);
  view.dispose();
  restore();
});

test("HEP-2: Shift+1 still fits all and Cmd+1 is the board tab shortcut", () => {
  const fit = findShortcut({ key: "!", code: "Digit1", shift: true, alt: false, meta: false, ctrl: false });
  const tab = findShortcut({ key: "1", code: "Digit1", meta: true, shift: false, alt: false, ctrl: false });
  assert.equal(fit.action, "fitAll");
  assert.equal(tab.action, "boardTab");
  assert.equal(tab.tab, 0);
  const labels = SHORTCUTS.filter((row) => row.action === "boardTab").map((row) => row.keys);
  assert.deepEqual(labels, ["⌘1", "⌘2", "⌘3", "⌘4", "⌘5", "⌘6", "⌘7", "⌘8", "⌘9"]);

  const calls = [];
  let vp = { x: 0, y: 0, zoom: 1 };
  const ctl = createInteractions({
    actions: {
      board: () => ({ items: new Map(), edges: new Map() }),
      rects: () => new Map(),
      viewport: () => vp,
      size: () => ({ width: 800, height: 600 }),
      fitAll: () => { calls.push("fitAll"); },
      selectBoardTab: (index) => { calls.push(["tab", index]); return true; },
      setViewport: (next) => { vp = next; },
      onSelection: () => {},
      onTool: () => {},
      setGesturing: () => {},
      isFullscreen: () => true,
    },
    settings: { get: () => undefined },
  });
  assert.equal(ctl.handle({ type: "keydown", key: "!", code: "Digit1", shift: true, alt: false, meta: false, ctrl: false }), true);
  assert.equal(ctl.handle({ type: "keydown", key: "1", code: "Digit1", meta: true, shift: false, alt: false, ctrl: false }), true);
  assert.equal(ctl.handle({ type: "keydown", key: "4", code: "Digit4", meta: true, shift: false, alt: false, ctrl: false }), true);
  assert.deepEqual(calls, ["fitAll", ["tab", 0], ["tab", 3]]);
});

test("HEP-2: leaving fullscreen restores the same tabs for that graph only", () => {
  const stub = createDomStub();
  const restore = stub.install();
  const storage = memoryStorage();
  const store = createTabStore({ storage, graph: "Notes" });
  const first = mount(stub, { uid: "boardAAA1", title: "Alpha", store });
  mount(stub, { uid: "boardBBB2", title: "Beta", store }).view.dispose();
  const live = mount(stub, { uid: "boardCCC3", title: "Gamma", store });
  first.view.dispose();
  assert.equal(live.view.root.querySelectorAll(".pxd-fstab").length, 3);
  live.view.setFullscreen(false);
  stub.flushFrames();
  assert.equal(live.view.root.querySelector(".pxd-fstabs"), null);
  assert.equal(storage.getItem(tabStorageKey("Notes")) !== null, true);
  live.view.dispose();

  const again = createTabStore({ storage, graph: "Notes" });
  const back = mount(stub, { uid: "boardCCC3", title: "Gamma", store: again });
  assert.deepEqual(tabsOf(back.view.root).map((t) => t.uid), ["boardAAA1", "boardBBB2", "boardCCC3"]);
  assert.equal(tabsOf(back.view.root).find((t) => t.on).uid, "boardCCC3");
  back.view.dispose();

  const other = createTabStore({ storage, graph: "Other" });
  const foreign = mount(stub, { uid: "boardDDD4", title: "Delta", store: other });
  assert.deepEqual(tabsOf(foreign.view.root).map((t) => t.uid), ["boardDDD4"]);
  foreign.view.dispose();
  restore();
});

test("HEP-2: closing a tab does not delete the board", () => {
  const stub = createDomStub();
  const restore = stub.install();
  const store = createTabStore({ storage: memoryStorage(), graph: "Notes" });
  const picked = [];
  mount(stub, { uid: "boardAAA1", title: "Alpha", store }).view.dispose();
  const { view, deleted } = mount(stub, {
    uid: "boardBBB2",
    title: "Beta",
    store,
    onSelectTab: (uid) => picked.push(uid),
  });
  const alpha = view.root.querySelector('.pxd-fstab[data-uid="boardAAA1"] .pxd-fstab__x');
  alpha.click();
  assert.deepEqual(tabsOf(view.root).map((t) => t.uid), ["boardBBB2"]);
  assert.deepEqual(picked, []);
  assert.deepEqual(deleted, []);
  view.root.querySelector(".pxd-fstab__x").click();
  assert.equal(view.root.querySelectorAll(".pxd-fstab").length, 0);
  assert.equal(view.root.classList.contains("pxd-root--fullscreen"), true);
  assert.equal(view.root.dataset.board, "boardBBB2");
  assert.deepEqual(picked, []);
  assert.deepEqual(deleted, []);
  view.dispose();
  restore();
});

test("HEP-2: opening outside fullscreen does not add a tab, and the ? sheet lists Cmd+1..9", () => {
  const stub = createDomStub();
  const restore = stub.install();
  const storage = memoryStorage();
  const store = createTabStore({ storage, graph: "Notes" });
  const quiet = mount(stub, { uid: "boardAAA1", title: "Alpha", store, fullscreen: false });
  assert.equal(quiet.view.root.querySelector(".pxd-fstabs"), null);
  assert.equal(store.get().length, 0);
  quiet.view.setFullscreen(true);
  stub.flushFrames();
  assert.deepEqual(tabsOf(quiet.view.root).map((t) => t.uid), ["boardAAA1"]);
  const help = stub.dispatch(stub.window, "keydown", { key: "?", code: "Slash", shiftKey: true, metaKey: false, ctrlKey: false, altKey: false });
  assert.equal(help.defaultPrevented, true);
  const keys = [...quiet.view.root.querySelectorAll(".pxd-sheet__keys")].map((node) => node.textContent);
  for (let n = 1; n <= 9; n += 1) assert.equal(keys.includes(`⌘${n}`), true, `⌘${n}`);
  quiet.view.dispose();
  restore();
});

test("HEP-2: a tab shortcut past the end does not switch boards", () => {
  const stub = createDomStub();
  const restore = stub.install();
  const store = createTabStore({ storage: memoryStorage(), graph: "Notes" });
  const picked = [];
  const { view } = mount(stub, { uid: "boardAAA1", title: "Alpha", store, onSelectTab: (uid) => picked.push(uid) });
  stub.dispatch(stub.window, "keydown", { key: "4", code: "Digit4", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false });
  assert.deepEqual(picked, []);
  assert.equal(view.root.dataset.board, "boardAAA1");
  assert.equal(store.get().length, 1);
  view.dispose();
  restore();
});
