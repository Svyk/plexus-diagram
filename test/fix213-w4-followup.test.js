// 2.13.0 fix follow-up: A13 (halo refs capped), C1 (new drawing is one undo step), D1 (Deleted toast follows the delete).
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { openHaloPopover } from "../src/view/halo-pop.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { buildBoard, worldRects } from "../src/model/board.js";
import { createInteractions } from "../src/view/interactions.js";
import { mountBoardView } from "../src/view/board-view.js";

afterEach(() => {
  resetSessions();
  delete globalThis.RoamPlexus;
});

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

// ---- A13

test("A13: the halo popover shows the exact total, not the number of fetched times", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const t = Date.UTC(2026, 9, 4, 15, 0, 0);
    const handle = openHaloPopover({
      doc: stub.document,
      anchor: { left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 },
      model: { created: t, board: "B", section: "", userName: "", with: [], refTimes: [t, t + 1000], refTotal: 5000, boards: 1 },
      pageExists: () => false,
      renderString() {},
      unmount() {},
      onPulse() {},
    });
    assert.match(handle.el.querySelector(".pxd-halo__refs").textContent, /^Referenced 5000 times/);
  } finally {
    restore();
  }
});

test("A13: the board view loads the halo with the light pull and an aggregate, never the reverse-ref pull", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  const Base = globalThis.MutationObserver;
  const pulls = [];
  const queries = [];
  try {
    stub.localStorage.setItem("plexus-diagram:vp:Svy:board0001", JSON.stringify({ x: 0, y: 0, zoom: 1 }));
    const board = buildBoard({
      ":block/uid": "board0001",
      ":block/string": "{{[[diagram]]:Lab}}",
      ":block/props": { ":plexus": { ":v": 2 } },
      ":block/children": [{
        ":block/uid": "cardAAAA1", ":block/string": "Alpha", ":block/order": 0,
        ":block/props": { ":plexus": { ":x": 0, ":y": 0, ":w": 200, ":h": 100 } }, ":block/children": [],
      }],
    });
    const session = {
      uid: "board0001", board, rects: worldRects(board), links: [], coveredEdges: new Set(), busy: false,
      on: () => () => {}, release() {}, setLinkMode() {},
    };
    const host = {
      graph: "Svy", renderString() {}, renderBlock() {}, renderPage() {}, unmount() {},
      pullTree: () => [], blockString: () => null, pageUid: () => null, openBlock() {}, openInSidebar() {},
      searchPages: () => [], searchBlocks: () => [], related: () => [], cardStringForUid: (u) => `((${u}))`,
      listBoards: () => Promise.resolve([]), pdfHighlightTree: () => [],
      pullEntity(pattern) { pulls.push(pattern); return { ":create/time": 1000 }; },
      q(query) {
        queries.push(query);
        return /count/.test(query) ? [[4000, 1, 9]] : [];
      },
    };
    const mountEl = stub.document.createElement("div");
    stub.document.body.append(mountEl);
    const view = mountBoardView({ host, session, mountEl, settings: { get: () => undefined }, version: "2.13.0" });
    try {
      view.controller.select(["cardAAAA1"]);
      stub.flushFrames();
      stub.dispatch(view.root.querySelector(".pxd-toolbar__info"), "pointerenter", {});
      await tick(450);
    } finally {
      view.dispose();
    }
    assert.ok(pulls.length >= 1);
    for (const pattern of pulls) assert.doesNotMatch(pattern, /block\/_refs/);
    assert.ok(queries.some((q) => /count/.test(q)), "refs are counted by an aggregate");
  } finally {
    globalThis.MutationObserver = Base;
    restore();
  }
});

// ---- C1

test("C1: New drawing writes the drawing block and the ref card inside one host group", async () => {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({ uid: "b1", props: { plexus: { v: 2 } }, children: [] });
  const session = acquireSession("b1", { host, linkDelay: 0 });
  const realGroup = host.group.bind(host);
  let depth = 0;
  const seen = [];
  host.group = (fn) => {
    depth += 1;
    return realGroup(fn).finally(() => { depth -= 1; });
  };
  const origCreate = fake.api.data.block.create.bind(fake.api.data.block);
  fake.api.data.block.create = (args) => { seen.push(depth); return origCreate(args); };
  const ref = await session.createDrawing({ x: 10, y: 10 });
  assert.ok(ref);
  assert.equal(seen.length >= 2, true, "drawing block and ref card were both created");
  assert.ok(seen.every((d) => d >= 1), "every create ran inside a host group");
  let open = 0;
  const snapshot = [];
  host.group = (fn) => { open += 1; snapshot.push(open); return realGroup(fn); };
  await session.createDrawing({ x: 10, y: 10 });
  assert.equal(snapshot.length >= 1, true);
  assert.equal(snapshot[0], 1);
});

// ---- D1

function interactionsHarness(deleteItems) {
  const board = buildBoard({
    ":block/uid": "b",
    ":block/string": "{{[[diagram]]:Lab}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": [{
      ":block/uid": "cardAAAA1", ":block/string": "Alpha", ":block/order": 0,
      ":block/props": { ":plexus": { ":x": 0, ":y": 0, ":w": 200, ":h": 100 } }, ":block/children": [],
    }],
  });
  const rects = worldRects(board);
  const toasts = [];
  const actions = {
    board: () => board, rects: () => rects, viewport: () => ({ x: 0, y: 0, zoom: 1 }), size: () => ({ width: 800, height: 600 }),
    deleteItems,
    toast: (t) => toasts.push(t),
  };
  const ctl = createInteractions({ actions, settings: { get: () => undefined } });
  return { ctl, toasts };
}

test("D1: the Deleted toast waits for the delete and is skipped when the dialog is cancelled", async () => {
  let resolve;
  const pending = interactionsHarness(() => new Promise((r) => { resolve = r; }));
  pending.ctl.select(["cardAAAA1"]);
  assert.equal(pending.ctl.deleteSelection(false), true);
  await tick();
  assert.equal(pending.toasts.length, 0, "no toast while the confirm is open");
  resolve(null);
  await tick();
  assert.equal(pending.toasts.length, 0, "no toast after Cancel");

  const ok = interactionsHarness(() => Promise.resolve("done"));
  ok.ctl.select(["cardAAAA1"]);
  ok.ctl.deleteSelection(false);
  await tick();
  assert.equal(ok.toasts.at(-1).message, "Deleted");
});
