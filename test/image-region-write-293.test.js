// REG-2: an image region is a child of the image card, never of the board.
import assert from "node:assert/strict";
import test from "node:test";

import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { imageRegionString } from "../src/model/image-region.js";
import { parseRegion } from "../src/model/regions.js";
import "../src/views.js";

const frac = { rx: 0.25, ry: 0.3, rw: 0.2, rh: 0.25 };

function seed(uid, children) {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({
    uid,
    string: "Lab board",
    props: { plexus: { v: 2 } },
    children,
  });
  return { fake, host, session: acquireSession(uid, { host, linkDelay: 0 }) };
}

const imageCard = (children = []) => ({
  uid: "img1",
  string: "![ham](https://example.com/leg.png)",
  props: { plexus: { x: 0, y: 0, w: 280, h: 160 } },
  children,
});

const undoCount = (fake) => fake.calls.filter((call) => call[0] === "undo").length;

test("REG-2: a new container is its own undo, then the region is the next", async () => {
  const { fake, host, session } = seed("b1", [
    imageCard([{ uid: "cap", string: "note" }]),
    { uid: "ed", string: "Connections", props: { plexus: { type: "edges" } } },
    { uid: "boardbox", string: "{{[[plexus-regions]]}}", props: { plexus: { type: "regions" } }, open: false },
  ]);
  try {
    const pending = session.addImageRegion("img1", frac, "hamstring");
    assert.equal(typeof pending.uid, "string");
    const uid = await pending;
    assert.equal(uid, pending.uid);
    assert.deepEqual(fake.children("b1"), ["img1", "ed", "boardbox"]);
    assert.deepEqual(fake.children("boardbox"), []);
    const kids = fake.children("img1");
    assert.equal(kids[0], "cap");
    const box = kids[1];
    const container = fake.block(box);
    assert.equal(container.string, "{{[[plexus-regions]]}}");
    assert.equal(container.open, false);
    assert.equal(container.parent, "img1");
    assert.equal(container.props.plexus.type, "regions");
    assert.deepEqual(fake.children(box), [uid]);
    const child = fake.block(uid);
    assert.deepEqual(child.props, {});
    assert.equal(child.string, imageRegionString("img1", frac, "hamstring"));
    const region = parseRegion(child.string);
    assert.equal(region.kind, "img");
    assert.equal(region.drawingUid, "img1");
    assert.deepEqual(region.f, [0.25, 0.3, 0.2, 0.25]);
    assert.equal(region.caption, "hamstring");
    const before = undoCount(fake);
    await host.undo();
    assert.equal(undoCount(fake), before + 1);
    await host.undo();
    assert.equal(undoCount(fake), before + 2);
  } finally {
    session.release();
    resetSessions();
  }
});

test("REG-2: a second call reuses the container and is one undo", async () => {
  const { fake, host, session } = seed("b2", [
    imageCard(),
    { uid: "ed", string: "Connections", props: { plexus: { type: "edges" } } },
  ]);
  try {
    const first = session.addImageRegion("img1", frac, "hamstring");
    const firstUid = await first;
    const box = fake.children("img1")[0];
    const second = session.addImageRegion("img1", frac, "other", "reg000002");
    assert.equal(second.uid, "reg000002");
    const secondUid = await second;
    assert.equal(secondUid, "reg000002");
    assert.deepEqual(fake.children("b2"), ["img1", "ed"]);
    assert.deepEqual(fake.children("img1"), [box]);
    assert.deepEqual(fake.children(box), [firstUid, secondUid]);
    const before = undoCount(fake);
    await host.undo();
    assert.equal(undoCount(fake), before + 1);
  } finally {
    session.release();
    resetSessions();
  }
});

test("REG-2: a type-only container is reused, and a rejected fraction writes nothing", async () => {
  const { fake, host, session } = seed("b3", [
    imageCard([
      { uid: "box", string: "not the macro", props: { plexus: { type: "regions" } }, open: false },
    ]),
  ]);
  try {
    const bad = { rx: 0, ry: 0, rw: 0, rh: 0.2 };
    assert.equal(imageRegionString("img1", bad, "nope"), null);
    const rejected = session.addImageRegion("img1", bad, "nope");
    assert.equal(rejected.uid, undefined);
    assert.equal(await rejected, null);
    assert.deepEqual(fake.children("img1"), ["box"]);
    assert.deepEqual(fake.children("box"), []);
    const pending = session.addImageRegion("img1", frac, "hamstring");
    const uid = await pending;
    assert.equal(uid, pending.uid);
    assert.deepEqual(fake.children("b3"), ["img1"]);
    assert.deepEqual(fake.children("img1"), ["box"]);
    assert.deepEqual(fake.children("box"), [uid]);
    assert.equal(parseRegion(fake.block(uid).string).drawingUid, "img1");
    const before = undoCount(fake);
    await host.undo();
    assert.equal(undoCount(fake), before + 1);
  } finally {
    session.release();
    resetSessions();
  }
});
