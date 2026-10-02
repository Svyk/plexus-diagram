import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { buildBoard } from "../src/model/board.js";
import {
  SNAPSHOT_CHUNK,
  captureLayout,
  parseSnapshot,
  partitionSnapshots,
  planRestore,
  snapshotProps,
  snapshotTitle,
} from "../src/model/snapshots.js";
import { buildMenu, flattenMenu } from "../src/view/menu-model.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import "../src/snapshots.js";

afterEach(() => resetSessions());

const byId = (items, id) => flattenMenu(items).find((item) => item.id === id);

test("TP-4: a snapshot is dated JSON and restore rewrites only what moved", () => {
  assert.equal(snapshotTitle(new Date(2026, 9, 1, 21, 5)), "2026-10-01 21:05");
  const board = {
    uid: "b1",
    order: ["c1", "c2"],
    items: new Map([
      ["c1", { uid: "c1", x: 10, y: 20, w: 200, h: 80, color: "blue", collapsed: false, parentUid: "b1" }],
      ["c2", { uid: "c2", x: 30, y: 40, w: 200, h: 80, color: null, collapsed: true, parentUid: "s1", type: "card" }],
    ]),
  };
  const items = captureLayout(board);
  const parsed = parseSnapshot(snapshotProps(items));
  assert.deepEqual(parsed, [
    { uid: "c1", x: 10, y: 20, w: 200, h: 80, color: "blue", collapsed: false, parent: "b1" },
    { uid: "c2", x: 30, y: 40, w: 200, h: 80, color: null, collapsed: true, parent: "s1" },
  ]);
  assert.equal(JSON.stringify(snapshotProps(items)).includes("BT_attr"), false);
  const moved = {
    uid: "b1",
    items: new Map([
      ["c1", { ...board.items.get("c1"), x: 90 }],
      ["c2", { ...board.items.get("c2") }],
      ["gone", { uid: "gone", x: 0, y: 0, w: 1, h: 1, parentUid: "b1", collapsed: false }],
    ]),
  };
  assert.deepEqual(planRestore(parsed, moved), [[{
    op: "props", uid: "c1", x: 10, y: 20, w: 200, h: 80, color: "blue", collapsed: false,
  }]]);
  const reparent = {
    uid: "b1",
    items: new Map([
      ["s1", { uid: "s1", type: "section", x: 0, y: 0, w: 10, h: 10, color: null, collapsed: false, parentUid: "b1" }],
      ["c2", { uid: "c2", type: "card", x: 30, y: 40, w: 200, h: 80, color: null, collapsed: true, parentUid: "b1" }],
    ]),
  };
  assert.deepEqual(planRestore(parsed, reparent), [[
    { op: "move", uid: "c2", parent: "s1" },
  ]]);
});

test("TP-4: restore stays in chunks of 45 and keeps a move with its props", () => {
  const items = new Map();
  const entries = [];
  for (let i = 0; i < 30; i += 1) {
    items.set(`c${i}`, { uid: `c${i}`, type: "card", x: 0, y: 0, w: 10, h: 10, color: null, collapsed: false, parentUid: "b1" });
    entries.push({ uid: `c${i}`, x: 5, y: 6, w: 10, h: 10, color: null, collapsed: false, parent: "sec" });
  }
  items.set("sec", { uid: "sec", type: "section", x: 0, y: 0, w: 10, h: 10, color: null, collapsed: false, parentUid: "b1" });
  const chunks = planRestore(entries, { uid: "b1", items });
  assert.ok(chunks.every((chunk) => chunk.length <= SNAPSHOT_CHUNK && chunk.length > 0));
  assert.deepEqual(chunks.map((chunk) => chunk.length), [44, 16]);
  assert.equal(chunks[0][0].op, "move");
  assert.equal(chunks[0][1].op, "props");
  assert.equal(chunks[0][44], undefined);
});

test("TP-4: the menu keeps the 10 newest and lists older ones for delete", () => {
  const list = Array.from({ length: 11 }, (_, i) => ({ uid: `s${i}`, title: `t${i}` }));
  const parts = partitionSnapshots(list);
  assert.deepEqual(parts.newest.map((item) => item.uid), ["s10", "s9", "s8", "s7", "s6", "s5", "s4", "s3", "s2", "s1"]);
  assert.deepEqual(parts.older.map((item) => item.uid), ["s0"]);
  const menu = buildMenu("canvas", { snapshots: list });
  const restore = byId(menu, "restore-snapshot");
  assert.equal(restore.children[0].label, "t10");
  assert.equal(restore.children.length, 10);
  const older = byId(menu, "older-snapshots").children[0];
  assert.equal(older.label, "t0");
  assert.deepEqual(older.children.map((item) => item.id), ["snapshot:s0", "delete-snapshot:s0"]);
  assert.equal(byId(buildMenu("canvas", {}), "restore-snapshot").disabled, true);
  assert.equal(byId(buildMenu("canvas", {}), "older-snapshots"), undefined);
});

test("TP-4: the snapshots folder is not a canvas item", () => {
  const json = JSON.stringify({ items: [{ uid: "c1", x: 1, y: 2, w: 3, h: 4, color: null, collapsed: false, parent: "b1" }] });
  const board = buildBoard({
    ":block/uid": "b1",
    ":block/string": "{{[[diagram]]:Fixture}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": [
      {
        ":block/uid": "c1",
        ":block/string": "Card",
        ":block/order": 0,
        ":block/props": { ":plexus": { ":x": 1, ":y": 2, ":w": 3, ":h": 4 } },
      },
      {
        ":block/uid": "folder",
        ":block/string": "Snapshots",
        ":block/order": 1,
        ":block/open": false,
        ":block/props": { ":plexus": { ":type": "snapshots" } },
        ":block/children": [
          {
            ":block/uid": "snap",
            ":block/string": "2026-10-01 21:05",
            ":block/order": 0,
            ":block/props": { ":plexus": { ":type": "snapshot", ":json": json } },
          },
        ],
      },
    ],
  });
  assert.equal(board.items.has("folder"), false);
  assert.equal(board.items.has("snap"), false);
  assert.equal(board.snapshotsUid, "folder");
  assert.equal(board.snapshots.length, 1);
  assert.equal(board.snapshots[0].items[0].x, 1);
});

function setup() {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({ uid: "b1", string: "{{[[diagram]]:Fixture}}", props: { plexus: { v: 2 } }, children: [] });
  const session = acquireSession("b1", { host, settings: null, linkDelay: 0 });
  return { fake, session };
}

test("TP-4: save, move five cards, restore every position", async () => {
  const { fake, session } = setup();
  const uids = [];
  for (let i = 0; i < 5; i += 1) {
    uids.push(await session.createCard({ x: 80 + i * 30, y: 40, string: `Card ${i}`, w: 180, h: 90 }));
  }
  const before = uids.map((uid) => {
    const item = session.board.items.get(uid);
    return { uid, x: item.x, y: item.y, w: item.w, h: item.h, parent: item.parentUid };
  });
  const snapUid = await session.saveSnapshot(new Date(2026, 9, 1, 21, 5));
  const folder = session.board.snapshotsUid;
  assert.equal(fake.block(folder).string, "Snapshots");
  assert.equal(fake.block(folder).open, false);
  assert.equal(fake.props(folder).plexus.type, "snapshots");
  assert.equal(session.board.items.has(folder), false);
  assert.equal(fake.block(snapUid).string, "2026-10-01 21:05");
  assert.equal(fake.block(snapUid).parent, folder);
  await session.commitMove(uids, 140, 60);
  for (const row of before) assert.notEqual(session.board.items.get(row.uid).x, row.x);
  const ok = await session.restoreSnapshot(snapUid);
  assert.equal(ok, true);
  for (const row of before) {
    const item = session.board.items.get(row.uid);
    assert.equal(item.x, row.x);
    assert.equal(item.y, row.y);
    assert.equal(item.w, row.w);
    assert.equal(item.h, row.h);
    assert.equal(item.parentUid, row.parent);
  }
  assert.equal(await session.deleteSnapshot(snapUid), true);
  assert.equal(session.board.snapshots.length, 0);
  assert.equal(fake.block(folder).string, "Snapshots");
});
