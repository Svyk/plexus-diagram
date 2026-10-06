import assert from "node:assert/strict";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { dailyTitle, dailyUid, firstLine, journalRows, stepDay } from "../src/model/journal.js";
import { CARD_MIME } from "../src/model/drop.js";
import { createHost } from "../src/host/roam.js";
import { createPanel } from "../src/view/panel.js";
import { mountBoardView } from "../src/view/board-view.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const DAY = new Date(2026, 9, 6).getTime();
const timers = { later: () => () => {}, frame: () => () => {} };

function panelFor(on = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  const root = stub.document.createElement("div");
  root.className = "pxd-root";
  stub.document.body.append(root);
  const added = [];
  const panel = createPanel({
    doc: stub.document,
    root,
    host: {},
    timers,
    on: { now: () => DAY, addBeside: (s) => added.push(s), ...on },
  });
  return { stub, restore, root, panel, added };
}

test("HEP-1: journal rows are the top-level blocks, first line only, in block order", () => {
  const rows = journalRows({
    ":block/children": [
      { ":block/uid": "late", ":block/string": "Third\nmore", ":block/order": 2 },
      { ":block/uid": "early", ":block/string": "First", ":block/order": 0, ":block/children": [{ ":block/uid": "kid", ":block/string": "nested" }] },
      { ":block/uid": "mid", ":block/string": "Second", ":block/order": 1 },
      { ":block/string": "no uid" },
    ],
  });
  assert.deepEqual(rows.map((r) => r.uid), ["early", "mid", "late"]);
  assert.equal(rows[0].string, "((early))");
  assert.equal(rows[2].text, "Third");
  assert.equal(firstLine("a\nb"), "a");
  assert.equal(dailyTitle(DAY), "October 6th, 2026");
  assert.equal(dailyUid(DAY), "10-06-2026");
  assert.equal(dailyTitle(stepDay(DAY, 1)), "October 7th, 2026");
  assert.equal(dailyTitle(stepDay(DAY, -1)), "October 5th, 2026");
});

test("HEP-1: the Journal tab lists that day's blocks and a click writes nothing", async () => {
  const seen = [];
  const f = panelFor({
    loadJournal: (date) => {
      seen.push(date);
      return {
        title: dailyTitle(date),
        rows: [
          { uid: "blk1", string: "((blk1))", text: "Morning note" },
          { uid: "blk2", string: "((blk2))", text: "Second block" },
        ],
      };
    },
  });
  f.panel.open("journal");
  await Promise.resolve();
  const rows = f.root.querySelectorAll(".pxd-journal__row");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].textContent, "Morning note");
  assert.equal(rows[0].getAttribute("data-string"), "((blk1))");
  assert.equal(f.root.querySelector(".pxd-journal__date").textContent, "October 6th, 2026");
  assert.equal(seen.length, 1);
  rows[0].click();
  rows[1].click();
  assert.deepEqual(f.added, []);
  f.panel.dispose();
  f.restore();
});

test("HEP-1: stepping the date follows the day and does not write", async () => {
  const seen = [];
  const f = panelFor({
    loadJournal: (date) => {
      seen.push(dailyTitle(date));
      return { title: dailyTitle(date), rows: [{ uid: "only", string: "((only))", text: dailyTitle(date) }] };
    },
  });
  f.panel.open("journal");
  await Promise.resolve();
  f.root.querySelector(".pxd-journal__next").click();
  await Promise.resolve();
  f.root.querySelector(".pxd-journal__next").click();
  await Promise.resolve();
  f.root.querySelector(".pxd-journal__prev").click();
  await Promise.resolve();
  assert.deepEqual(seen, [
    "October 6th, 2026",
    "October 7th, 2026",
    "October 8th, 2026",
    "October 7th, 2026",
  ]);
  f.root.querySelector(".pxd-journal__today").click();
  await Promise.resolve();
  assert.equal(seen[seen.length - 1], "October 6th, 2026");
  f.root.querySelector(".pxd-journal__row").click();
  assert.deepEqual(f.added, []);
  f.panel.dispose();
  f.restore();
});

test("HEP-1: a journal row drag is the block ref", async () => {
  const f = panelFor({
    loadJournal: () => ({ rows: [{ uid: "blk9", string: "((blk9))", text: "Drag me" }] }),
  });
  f.panel.open("journal");
  await Promise.resolve();
  const data = {};
  const row = f.root.querySelector(".pxd-journal__row");
  row.dispatchEvent({
    type: "dragstart",
    dataTransfer: {
      setData(key, value) { data[key] = value; },
      effectAllowed: "",
    },
  });
  assert.equal(data[CARD_MIME], "((blk9))");
  assert.equal(data["text/plain"], "((blk9))");
  row.click();
  assert.deepEqual(f.added, []);
  f.panel.dispose();
  f.restore();
});

test("HEP-1: an empty day shows the empty line and writes nothing", async () => {
  const f = panelFor({ loadJournal: () => ({ title: dailyTitle(DAY), rows: [] }) });
  f.panel.open("journal");
  await Promise.resolve();
  const empty = f.root.querySelector(".pxd-journal__empty");
  assert.equal(empty.textContent, "Nothing on this day.");
  assert.equal(f.root.querySelectorAll(".pxd-journal__row").length, 0);
  assert.deepEqual(f.added, []);
  f.panel.dispose();
  f.restore();
});

test("HEP-1: dailyBlocks reads the top-level blocks and does not write", () => {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  const title = dailyTitle(DAY);
  fake.seedPage({
    title,
    uid: dailyUid(DAY),
    children: [
      { uid: "blk1", string: "First line\nstill the same block" },
      { uid: "blk2", string: "Second", children: [{ uid: "kid1", string: "nested" }] },
    ],
  });
  const before = [fake.block("blk1").string, fake.block("blk2").string, fake.block("kid1").string];
  const day = host.dailyBlocks(DAY);
  assert.equal(day.exists, true);
  assert.equal(day.uid, dailyUid(DAY));
  assert.equal(day.rows.length, 2);
  assert.deepEqual(day.rows.map((r) => r.text), ["First line", "Second"]);
  assert.equal(day.rows[0].string, "((blk1))");
  assert.equal(host.stats.writes, 0);
  assert.deepEqual(fake.writesLog(), []);
  assert.deepEqual([fake.block("blk1").string, fake.block("blk2").string, fake.block("kid1").string], before);

  const missing = host.dailyBlocks(stepDay(DAY, 3));
  assert.equal(missing.exists, false);
  assert.deepEqual(missing.rows, []);
  assert.equal(host.stats.writes, 0);
  assert.deepEqual(fake.writesLog(), []);
});

test("HEP-1: a daily page found by its MM-DD-YYYY uid is still a read", () => {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedPage({
    title: "Not the daily title",
    uid: dailyUid(DAY),
    children: [{ uid: "blk1", string: "From the uid" }],
  });
  const day = host.dailyBlocks(DAY);
  assert.equal(day.exists, true);
  assert.equal(day.uid, dailyUid(DAY));
  assert.equal(day.rows[0].text, "From the uid");
  assert.equal(host.stats.writes, 0);
  assert.deepEqual(fake.writesLog(), []);
});

test("HEP-1: opening Journal on a board pulls that day and a click writes nothing", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedPage({
    title: dailyTitle(new Date()),
    uid: dailyUid(new Date()),
    children: [{ uid: "today1", string: "On the daily page" }],
  });
  const pulled = {
    ":block/uid": "board0001",
    ":block/string": "{{[[diagram]]:Empty}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": [],
  };
  const board = buildBoard(pulled);
  const session = { uid: board.uid, board, rects: worldRects(board), links: [], coveredEdges: new Set(), on() { return () => {}; }, release() {} };
  const mountEl = stub.document.createElement("div");
  stub.document.body.append(mountEl);
  const view = mountBoardView({ host, session, mountEl, settings: { get: () => undefined } });
  stub.flushFrames();
  const writes = host.stats.writes;
  view.root.querySelector('[data-tab="journal"]').click();
  await Promise.resolve();
  await Promise.resolve();
  const rows = view.root.querySelectorAll(".pxd-journal__row");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].textContent, "On the daily page");
  rows[0].click();
  view.root.querySelector(".pxd-journal__next").click();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(view.root.querySelector(".pxd-journal__empty").textContent, "Nothing on this day.");
  assert.equal(host.stats.writes, writes);
  assert.deepEqual(fake.writesLog(), []);
  assert.equal(fake.block("today1").string, "On the daily page");
  view.dispose();
  restore();
});
