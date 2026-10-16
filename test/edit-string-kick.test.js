// A2. A big board's section watch must not kick when the only change is the string of the card being edited.
// The session model still takes that string. A sibling, props, heading, open, or order change still kicks.
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { createHost } from "../src/host/roam.js";
import { SPLIT_WATCH_MIN, STRUCT_PATTERN } from "../src/host/split-watch.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { noteSpeedFlags } from "../src/settings.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";

afterEach(() => {
  resetSessions();
  noteSpeedFlags(null);
});

const FILL = 2050;

function boardChildren() {
  const section = {
    uid: "sec1",
    string: "Notes",
    props: { plexus: { type: "section", x: 0, y: 0, w: 900, h: 500 } },
    children: [
      { uid: "editMe", string: "Hello", props: { plexus: { x: 8, y: 40, w: 200, h: 80 } }, children: [{ uid: "body1", string: "line" }] },
      { uid: "sib", string: "Other", props: { plexus: { x: 230, y: 40, w: 200, h: 80 } } },
    ],
  };
  const filler = Array.from({ length: FILL }, (_, i) => ({
    uid: `f${i}`,
    string: `fill ${i}`,
    props: { plexus: { x: (i % 40) * 16, y: 600 + Math.floor(i / 40) * 16, w: 40, h: 20 } },
  }));
  return [section, ...filler];
}

function open() {
  const fake = createFakeRoam({ echoDelay: 1 });
  fake.roamWatch = true;
  fake.seedBoard({ uid: "b1", string: "{{[[diagram]]}}", props: { plexus: { v: 2 } }, children: boardChildren() });
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  let kicks = 0;
  const watch = host.watchBoard.bind(host);
  host.watchBoard = (id, cb) => watch(id, (tree) => {
    kicks += 1;
    return cb(tree);
  });
  const session = acquireSession("b1", {
    host,
    raf: (fn) => fn(),
    linkDelay: 0,
    settings: { "graph-links": "off" },
  });
  return { fake, host, session, kicks: () => kicks };
}

const settle = (fake) => fake.flush();

async function ready() {
  const opened = open();
  await settle(opened.fake);
  assert.ok(opened.session.board.items.size >= SPLIT_WATCH_MIN);
  const watches = opened.fake.watchList();
  assert.ok(watches.some((w) => w.uid === "b1" && w.pattern === STRUCT_PATTERN));
  assert.ok(watches.some((w) => w.uid === "sec1" && w.pattern === STRUCT_PATTERN));
  assert.equal(opened.kicks(), 0);
  opened.session.setEditing("editMe");
  return opened;
}

test("a re-pull that only changes the editing card's string does not kick, and the model string updates", async () => {
  const { fake, host, session, kicks } = await ready();
  const board = session.board;
  const changes = [];
  session.on("change", (payload) => changes.push(payload));
  await fake.api.data.block.update({ block: { uid: "editMe", string: "Hello!" } });
  await settle(fake);
  assert.equal(kicks(), 0);
  assert.equal(session.board, board);
  assert.equal(session.board.items.get("editMe").string, "Hello!");
  assert.equal(host.blockString("editMe"), "Hello!");
  assert.equal(changes.length, 1);
  assert.equal(changes[0].structural, false);
  assert.ok(changes[0].dirty.has("editMe"));
});

test("a sibling block created in the same transaction still kicks", async () => {
  const { fake, session, kicks } = await ready();
  await fake.api.data.block.update({ block: { uid: "editMe", string: "Hello there" } });
  await fake.api.data.block.create({
    location: { "parent-uid": "sec1", order: "last" },
    block: { uid: "auto1", string: "Spawned", props: { plexus: { x: 460, y: 40, w: 200, h: 80 } } },
  });
  await settle(fake);
  assert.equal(kicks(), 1);
  assert.equal(session.board.items.get("auto1").string, "Spawned");
  assert.equal(session.board.items.get("editMe").string, "Hello there");
});

test("a props change on the editing card still kicks", async () => {
  const { fake, kicks } = await ready();
  await fake.api.data.block.update({
    block: { uid: "editMe", props: { plexus: { x: 40, y: 40, w: 200, h: 80 } } },
  });
  await settle(fake);
  assert.equal(kicks(), 1);
});

test("a string change on a card that is not being edited still kicks", async () => {
  const { fake, session, kicks } = await ready();
  await fake.api.data.block.update({ block: { uid: "sib", string: "Other!" } });
  await settle(fake);
  assert.equal(kicks(), 1);
  assert.equal(session.board.items.get("sib").string, "Other!");
});

test("heading, open, and order changes on the editing card still kick", async () => {
  const heading = await ready();
  await heading.fake.api.data.block.update({ block: { uid: "editMe", heading: 1 } });
  await settle(heading.fake);
  assert.equal(heading.kicks(), 1);

  const opened = await ready();
  await opened.fake.api.data.block.update({ block: { uid: "editMe", open: false } });
  await settle(opened.fake);
  assert.equal(opened.kicks(), 1);

  const moved = await ready();
  await moved.fake.api.data.block.move({ location: { "parent-uid": "sec1", order: 0 }, block: { uid: "sib" } });
  await settle(moved.fake);
  assert.equal(moved.kicks(), 1);
});

test("two string changes in one re-pull still kick", async () => {
  const { fake, kicks } = await ready();
  await fake.api.data.block.update({ block: { uid: "editMe", string: "Hello!" } });
  await fake.api.data.block.update({ block: { uid: "sib", string: "Other!" } });
  await settle(fake);
  assert.equal(kicks(), 1);
});

test("editQuiet off kicks on the editing card's string", async () => {
  noteSpeedFlags({ editQuiet: false });
  const { fake, kicks } = await ready();
  await fake.api.data.block.update({ block: { uid: "editMe", string: "Hello!" } });
  await settle(fake);
  assert.equal(kicks(), 1);
});
