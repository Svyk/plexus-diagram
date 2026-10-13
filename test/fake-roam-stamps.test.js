// The fake models Roam's :edit/time rules (project_grok_verify): stamped only on the entity whose string or props
// changed; create/move/delete never stamp the parent; a delete renumbers siblings without a stamp; undo re-stamps;
// every write tx stamps the page's edit time and a fresh nonce.
import assert from "node:assert/strict";
import test from "node:test";
import { createFakeRoam } from "./fixtures/fake-roam.js";

const PATTERN = "[:block/uid :block/order :edit/time {(limit :block/children nil) [:block/uid :block/order :edit/time]}]";

function setup() {
  const fake = createFakeRoam({ echoDelay: 0, stamps: true });
  fake.seedPage({ title: "P", uid: "page1", children: [{ uid: "par", string: "parent", children: [{ uid: "a", string: "a" }, { uid: "b", string: "b" }, { uid: "c", string: "c" }] }] });
  const read = () => fake.api.data.pull(PATTERN, [":block/uid", "par"]);
  const kid = (tree, uid) => tree[":block/children"].find((k) => k[":block/uid"] === uid);
  return { fake, read, kid };
}

test("a pull names :edit/time or does not get it", () => {
  const { fake } = setup();
  assert.equal(fake.api.data.pull("[:block/uid :block/string]", [":block/uid", "par"])[":edit/time"], undefined);
  assert.ok(fake.api.data.pull(PATTERN, [":block/uid", "par"])[":edit/time"] > 0);
  const plain = createFakeRoam({ echoDelay: 0 });
  plain.seedPage({ title: "Q", uid: "q", children: [{ uid: "x", string: "x" }] });
  assert.equal(plain.api.data.pull(PATTERN, [":block/uid", "x"])[":edit/time"], undefined, "stamps are opt-in");
});

test("a string edit stamps that block only; a props edit too; same-value updates do not", async () => {
  const { fake, read, kid } = setup();
  const before = read();
  await fake.api.data.block.update({ block: { uid: "b", string: "b2" } });
  const after = read();
  assert.notEqual(kid(after, "b")[":edit/time"], kid(before, "b")[":edit/time"]);
  assert.equal(kid(after, "a")[":edit/time"], kid(before, "a")[":edit/time"]);
  assert.equal(after[":edit/time"], before[":edit/time"], "the parent is not stamped");
  await fake.api.data.block.update({ block: { uid: "b", string: "b2" } });
  assert.equal(kid(read(), "b")[":edit/time"], kid(after, "b")[":edit/time"], "an unchanged string is not a change");
  await fake.api.data.block.update({ block: { uid: "c", props: { plexus: { x: 1 } } } });
  assert.notEqual(kid(read(), "c")[":edit/time"], kid(after, "c")[":edit/time"]);
});

test("create, move and delete never stamp the parent; delete renumbers siblings without a stamp", async () => {
  const { fake, read, kid } = setup();
  const before = read();
  await fake.api.data.block.create({ location: { "parent-uid": "par", order: "last" }, block: { uid: "d", string: "d" } });
  assert.equal(read()[":edit/time"], before[":edit/time"]);
  assert.ok(kid(read(), "d")[":edit/time"] > 0, "a new block is stamped itself");
  await fake.api.data.block.move({ location: { "parent-uid": "par", order: 0 }, block: { uid: "c" } });
  const moved = read();
  assert.equal(moved[":edit/time"], before[":edit/time"]);
  assert.equal(kid(moved, "c")[":edit/time"], kid(before, "c")[":edit/time"], "a move is not an edit");
  assert.equal(kid(moved, "c")[":block/order"], 0);
  await fake.api.data.block.delete({ block: { uid: "a" } });
  const gone = read();
  assert.equal(gone[":edit/time"], before[":edit/time"]);
  assert.equal(kid(gone, "b")[":edit/time"], kid(before, "b")[":edit/time"]);
  assert.notEqual(kid(gone, "b")[":block/order"], kid(moved, "b")[":block/order"], "the order moved");
});

test("undo re-stamps the block it brings back; every write stamps the page and a fresh nonce", async () => {
  const { fake, read, kid } = setup();
  fake.trackUndo = true;
  const page = () => fake.api.data.pull("[:block/uid :page/edit-time :page/edit-nonce]", [":block/uid", "page1"]);
  const p0 = page();
  await fake.api.data.block.update({ block: { uid: "b", string: "b2" } });
  const p1 = page();
  assert.notEqual(p1[":page/edit-nonce"], p0[":page/edit-nonce"]);
  assert.ok(p1[":page/edit-time"] > p0[":page/edit-time"]);
  const stamped = kid(read(), "b")[":edit/time"];
  await fake.api.data.undo();
  assert.notEqual(kid(read(), "b")[":edit/time"], stamped, "undo stamped the restored block anew");
  assert.equal(fake.api.data.pull("[:block/uid :block/string]", [":block/uid", "b"])[":block/string"], "b");
});
