// PDF-5: a highlight region is one txn under the highlight block, which is not on the board.
import assert from "node:assert/strict";
import test from "node:test";

import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { imageRegionString } from "../src/model/image-region.js";
import { parseRegion } from "../src/model/regions.js";
import "../src/views.js";

const frac = { rx: 0.25, ry: 0.3, rw: 0.2, rh: 0.25 };
const highlightUid = "hl211201";

function seed() {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedPage({
    uid: "pg1",
    title: "Paper.pdf",
    children: [{ uid: highlightUid, string: "area #h/yellow" }],
  });
  fake.seedBoard({
    uid: "b1",
    string: "Lab board",
    props: { plexus: { v: 2 } },
    children: [
      { uid: "c1", string: `((${highlightUid}))`, props: { plexus: { x: 0, y: 0, w: 280, h: 160 } } },
    ],
  });
  return { fake, host, session: acquireSession("b1", { host, linkDelay: 0 }) };
}

const undoCount = (fake) => fake.calls.filter((call) => call[0] === "undo").length;

test("addHighlightRegion creates the container and the region in one transaction", async () => {
  const { fake, host, session } = seed();
  const creates = [];
  const write = host.createBlock.bind(host);
  host.createBlock = async (spec) => {
    creates.push(spec);
    return write(spec);
  };
  let imageCalls = 0;
  const addImageRegion = session.addImageRegion;
  session.addImageRegion = (...args) => {
    imageCalls += 1;
    return addImageRegion(...args);
  };
  try {
    assert.equal(session.board.items.has(highlightUid), false);
    assert.deepEqual(fake.children("b1"), ["c1"]);
    const pending = session.addHighlightRegion(highlightUid, frac, "hamstring", "reg211201");
    assert.equal(pending.uid, "reg211201");
    const uid = await pending;
    assert.equal(uid, "reg211201");
    assert.equal(imageCalls, 0);
    assert.equal(creates.length, 2);
    assert.equal(creates[0].parentUid, highlightUid);
    assert.equal(creates[1].parentUid, creates[0].uid);
    assert.equal(creates[1].uid, "reg211201");
    assert.equal(creates[0].string, "{{[[plexus-regions]]}}");
    assert.equal(creates[0].open, false);
    assert.equal(creates[0].props.plexus.type, "regions");
    assert.equal(creates[1].string, imageRegionString(highlightUid, frac, "hamstring"));
    assert.equal(creates[1].props, undefined);
    const box = creates[0].uid;
    assert.equal(fake.block(box).parent, highlightUid);
    assert.equal(fake.block(box).string, "{{[[plexus-regions]]}}");
    assert.equal(fake.block(box).open, false);
    assert.deepEqual(fake.children(highlightUid), [box]);
    assert.deepEqual(fake.children(box), [uid]);
    assert.equal(fake.block(uid).parent, box);
    assert.deepEqual(fake.block(uid).props, {});
    const region = parseRegion(fake.block(uid).string);
    assert.equal(region.kind, "img");
    assert.equal(region.drawingUid, highlightUid);
    assert.deepEqual(region.f, [0.25, 0.3, 0.2, 0.25]);
    assert.equal(region.caption, "hamstring");
    assert.deepEqual(fake.children("b1"), ["c1"]);
    assert.equal(fake.writesLog().length, 2);
    const before = undoCount(fake);
    await host.undo();
    assert.equal(undoCount(fake), before + 2);
  } finally {
    session.release();
    resetSessions();
  }
});

test("a rejected fraction writes nothing", async () => {
  const { fake, session } = seed();
  try {
    const bad = { rx: 0, ry: 0, rw: 0, rh: 0.2 };
    assert.equal(imageRegionString(highlightUid, bad, "nope"), null);
    const rejected = session.addHighlightRegion(highlightUid, bad, "nope");
    assert.equal(rejected.uid, undefined);
    assert.equal(await rejected, null);
    assert.deepEqual(fake.children(highlightUid), []);
    assert.equal(fake.writesLog().length, 0);
  } finally {
    session.release();
    resetSessions();
  }
});
