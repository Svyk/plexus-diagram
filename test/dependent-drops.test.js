// A published edge list that comes up short (a failed or stale read) must not delete the arrows that end on the
// missing edge while Roam still has it.
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";

afterEach(() => resetSessions());

function open() {
  const stub = createDomStub();
  const restore = stub.install();
  const fake = createFakeRoam({ echoDelay: 0 });
  fake.seedBoard({
    uid: "b1",
    props: { plexus: { v: 2 } },
    children: [
      { uid: "c0", string: "c0", props: { plexus: { x: 0, y: 0, w: 200, h: 100 } } },
      { uid: "c1", string: "c1", props: { plexus: { x: 300, y: 0, w: 200, h: 100 } } },
      { uid: "E", string: "Connections", props: { plexus: { type: "edges" } }, children: [
        { uid: "e1", string: "[[c0]] → x → [[c1]]", props: { plexus: { type: "edge", from: "c0", to: "c1" } } },
        { uid: "e2", string: "[[e1]] → y → [[c1]]", props: { plexus: { type: "edge", from: "e1", to: "c1" } } },
      ] },
    ],
  });
  const real = createHost({ api: fake.api, storage: stub.localStorage, graph: "g" });
  const watchers = [];
  const host = Object.create(real);
  host.watchBoard = (id, cb) => { watchers.push(cb); return real.watchBoard(id, cb); };
  const session = acquireSession("b1", { host, raf: (fn) => fn() });
  return { fake, real, session, watchers, restore };
}
const withoutEdge = (tree, uid) => {
  const clone = JSON.parse(JSON.stringify(tree));
  for (const kid of clone[":block/children"]) if (kid[":block/uid"] === "E") kid[":block/children"] = kid[":block/children"].filter((e) => e[":block/uid"] !== uid);
  return clone;
};
const deletes = (fake) => fake.log.filter((l) => l[0] === "delete");
const tick = () => new Promise((r) => setTimeout(r, 20));

test("a short edge list while Roam still has the edge deletes nothing and the board is read again", async () => {
  const { fake, real, session, watchers, restore } = open();
  try {
    const full = real.pullBoard("b1", { light: true });
    assert.ok(session.board.edges.has("e1") && session.board.edges.has("e2"));
    for (const cb of watchers) cb(withoutEdge(full, "e1"));
    await tick(); await tick();
    assert.deepEqual(deletes(fake), [], "no delete reached Roam");
    assert.ok(fake.block("e2"), "the arrow onto e1 is still in Roam");
    assert.ok(session.board.edges.has("e1"), "the read-again brought e1 back");
  } finally { restore(); }
});

test("an edge Roam really lost still takes its dependents with it", async () => {
  const { fake, real, session, watchers, restore } = open();
  try {
    await fake.api.data.block.delete({ block: { uid: "e1" } });
    const tree = real.pullBoard("b1", { light: true });
    for (const cb of watchers) cb(tree);
    await tick(); await tick();
    assert.deepEqual(deletes(fake).map((l) => l[1]).filter((u) => u === "e2"), ["e2"]);
  } finally { restore(); }
});
