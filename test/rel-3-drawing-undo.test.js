// REL-3. New drawing is one undo step: the drawing block and the ref card.
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";

const MACRO = "{{[[excalidraw]]}}";
const DRAW = "draw0001";

afterEach(() => {
  resetSessions();
  delete globalThis.RoamPlexus;
});

// The stock fake records undo calls and does not move blocks. This journal does.
function attachUndo(fake) {
  const undoStack = [];
  const redoStack = [];
  const block = fake.api.data.block;
  const raw = {
    create: block.create.bind(block),
    update: block.update.bind(block),
    move: block.move.bind(block),
    delete: block.delete.bind(block),
  };
  const snap = (uid) => fake.block(uid);
  const record = (entry) => {
    undoStack.push(entry);
    redoStack.length = 0;
  };
  block.create = async (arg) => {
    await raw.create(arg);
    const shot = snap(arg.block.uid);
    record({
      async undo() { await raw.delete({ block: { uid: shot.uid } }); },
      async redo() {
        await raw.create({
          location: { "parent-uid": shot.parent, order: shot.order },
          block: { uid: shot.uid, string: shot.string, props: shot.props, open: shot.open, heading: shot.heading },
        });
      },
    });
  };
  block.update = async (arg) => {
    const before = snap(arg.block.uid);
    await raw.update(arg);
    const after = snap(arg.block.uid);
    record({
      async undo() {
        await raw.update({ block: { uid: before.uid, string: before.string, props: before.props, open: before.open, heading: before.heading } });
      },
      async redo() {
        await raw.update({ block: { uid: after.uid, string: after.string, props: after.props, open: after.open, heading: after.heading } });
      },
    });
  };
  block.move = async (arg) => {
    const before = snap(arg.block.uid);
    await raw.move(arg);
    const after = snap(arg.block.uid);
    record({
      async undo() {
        await raw.move({ location: { "parent-uid": before.parent, order: before.order }, block: { uid: before.uid } });
      },
      async redo() {
        await raw.move({ location: { "parent-uid": after.parent, order: after.order }, block: { uid: after.uid } });
      },
    });
  };
  block.delete = async (arg) => {
    const before = snap(arg.block.uid);
    await raw.delete(arg);
    record({
      async undo() {
        await raw.create({
          location: { "parent-uid": before.parent, order: before.order },
          block: { uid: before.uid, string: before.string, props: before.props, open: before.open },
        });
      },
      async redo() { await raw.delete({ block: { uid: before.uid } }); },
    });
  };
  fake.api.data.undo = async () => {
    fake.calls.push(["undo"]);
    const entry = undoStack.pop();
    if (!entry) return;
    await entry.undo();
    redoStack.push(entry);
  };
  fake.api.data.redo = async () => {
    fake.calls.push(["redo"]);
    const entry = redoStack.pop();
    if (!entry) return;
    await entry.redo();
    undoStack.push(entry);
  };
}

function setup() {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({
    uid: "b1",
    props: { plexus: { v: 2 } },
    children: [{ uid: "neighbour", string: "Neighbour" }],
  });
  attachUndo(fake);
  const session = acquireSession("b1", { host, linkDelay: 0 });
  return { fake, host, session };
}

function drawingBlock(fake) {
  return fake.children("b1").map((uid) => fake.block(uid)).find((block) => block?.string === MACRO) || null;
}

test("Roam Plexus new drawing undoes and redoes the drawing and the ref together", async () => {
  const { fake, host, session } = setup();
  const prior = await host.createBlock({ parentUid: "b1", string: "Prior card" });
  globalThis.RoamPlexus = {
    apiVersion: 7,
    create(args) {
      return fake.api.data.block.create({
        location: { "parent-uid": args.parentUid, order: args.order },
        block: { uid: DRAW, string: MACRO },
      }).then(() => ({ uid: DRAW, pageUid: null }));
    },
  };
  const before = host.stats.writes;
  fake.clearLog();
  const ref = await session.createDrawing({ x: 40, y: 40 });
  const writes = fake.writesLog().length;
  assert.ok(writes <= 45);
  assert.ok(host.stats.writes - before <= 45);
  assert.equal(fake.block(DRAW).string, MACRO);
  assert.equal(fake.block(ref).string, `((${DRAW}))`);

  fake.calls.length = 0;
  await session.undo();
  assert.equal(fake.calls.filter((call) => call[0] === "undo").length, writes);
  assert.equal(fake.has(DRAW), false);
  assert.equal(fake.block(ref), null);
  assert.ok(fake.block(prior));
  assert.equal(fake.block("neighbour").string, "Neighbour");

  await session.redo();
  assert.equal(fake.block(DRAW).string, MACRO);
  assert.equal(fake.block(ref).string, `((${DRAW}))`);
  assert.ok(fake.block(prior));
  assert.equal(fake.block("neighbour").string, "Neighbour");

  await session.undo();
  assert.equal(fake.has(DRAW), false);
  assert.equal(fake.block(ref), null);
  await session.undo();
  assert.equal(fake.block("neighbour").string, "Neighbour");
});

test("fallback new drawing, with Roam Plexus unloaded, undoes in one step", async () => {
  const { fake, host, session } = setup();
  const prior = await host.createBlock({ parentUid: "b1", string: "Prior card" });
  const before = host.stats.writes;
  fake.clearLog();
  const ref = await session.createDrawing({ x: 12, y: 16 });
  const writes = fake.writesLog().length;
  const drawing = drawingBlock(fake);
  assert.ok(drawing);
  assert.ok(writes <= 45);
  assert.ok(host.stats.writes - before <= 45);
  assert.equal(fake.block(ref).string, `((${drawing.uid}))`);

  fake.calls.length = 0;
  await session.undo();
  assert.equal(fake.calls.filter((call) => call[0] === "undo").length, writes);
  assert.equal(drawingBlock(fake), null);
  assert.equal(fake.block(ref), null);
  assert.ok(fake.block(prior));
  assert.equal(fake.block("neighbour").string, "Neighbour");

  await session.redo();
  const restored = drawingBlock(fake);
  assert.ok(restored);
  assert.equal(fake.block(ref).string, `((${restored.uid}))`);

  await session.undo();
  await session.undo();
  assert.equal(fake.block("neighbour").string, "Neighbour");
});

test("adoptCreated outside a group does not add an undo", async () => {
  const { fake, host } = setup();
  host.adoptCreated("neighbour");
  fake.calls.length = 0;
  await host.undo();
  assert.deepEqual(fake.calls.map((call) => call[0]), ["undo"]);
  assert.equal(fake.block("neighbour").string, "Neighbour");
});
