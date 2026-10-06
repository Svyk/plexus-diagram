// FAST-5: pauseWatches drops the pull watch without destroy. setEditing and the props cache stay.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";

afterEach(() => resetSessions());

const HL_PROPS = { "pdf-highlight": { type: "text", content: { text: "x" }, position: { boundingRect: { pageNumber: 1 } } } };

function setup() {
  const fake = createFakeRoam({ echoDelay: 0 });
  fake.seedBoard({
    uid: "b1",
    props: { plexus: { v: 2 } },
    children: [{
      uid: "n1",
      string: "Hello",
      props: { plexus: { x: 0, y: 0, w: 200, h: 80 } },
      children: [{ uid: "k1", string: "kid" }],
    }],
  });
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  const session = acquireSession("b1", {
    host,
    raf: (fn) => fn(),
    linkDelay: 0,
    settings: { "graph-links": "off" },
  });
  return { fake, host, session };
}

function countPulls(host) {
  const pulls = [];
  const orig = host.pullBoard.bind(host);
  host.pullBoard = (uid) => {
    pulls.push(uid);
    return orig(uid);
  };
  return pulls;
}

test("pause drops the watch and resume pulls once without rebuilding an unchanged board", async () => {
  const { fake, host, session } = setup();
  await fake.flush();
  const pulls = countPulls(host);
  const board = session.board;
  board.sentinel = "keep";
  assert.equal(host.stats.watches, 1);
  const writes = fake.writesLog().length;
  session.pauseWatches();
  assert.equal(host.stats.watches, 0);
  assert.equal(fake.watchCount(), 0);
  session.resumeWatches();
  assert.equal(pulls.length, 1);
  assert.equal(pulls[0], "b1");
  assert.equal(session.board, board);
  assert.equal(session.board.sentinel, "keep");
  assert.equal(host.stats.watches, 1);
  assert.equal(fake.writesLog().length, writes);
  session.pauseWatches();
  session.release({ paused: true });
  assert.equal(host.stats.watches, 0);
});

test("setEditing still patches the open card after pause and resume", async () => {
  const { fake, session } = setup();
  await fake.flush();
  session.setEditing("n1");
  session.pauseWatches();
  session.resumeWatches();
  const board = session.board;
  board.sentinel = "hunt-2";
  const events = [];
  session.on("change", (diff) => events.push(diff));
  await fake.api.data.block.update({ block: { uid: "n1", string: "Hello!" } });
  await fake.flush();
  assert.equal(session.board, board);
  assert.equal(session.board.sentinel, "hunt-2");
  assert.equal(session.board.items.get("n1").string, "Hello!");
  assert.equal(events.length, 1);
  assert.equal(events[0].structural, false);
  assert.deepEqual([...events[0].dirty], ["n1"]);
});

test("a change while paused is applied by one pull on resume", async () => {
  const { fake, host, session } = setup();
  await fake.flush();
  const pulls = countPulls(host);
  session.pauseWatches();
  await fake.api.data.block.update({ block: { uid: "n1", string: "Away" } });
  await fake.flush();
  assert.equal(session.board.items.get("n1").string, "Hello");
  assert.equal(pulls.length, 0);
  const before = session.board;
  session.resumeWatches();
  assert.equal(pulls.length, 1);
  assert.notEqual(session.board, before);
  assert.equal(session.board.items.get("n1").string, "Away");
});

test("a second holder keeps the watch, and the props cache survives an unchanged resume", () => {
  const fake = createFakeRoam({ echoDelay: 0 });
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({
    uid: "b1",
    props: { plexus: { v: 2 } },
    children: [{ uid: "c1", string: "((hl01))", props: { plexus: { x: 0, y: 0, w: 200, h: 100 } } }],
  });
  const readString = host.blockString.bind(host);
  host.blockString = (id) => (id === "hl01" ? "text #h/yellow" : readString(id));
  let props = 0;
  host.blockProps = () => {
    props += 1;
    return { props: HL_PROPS, string: "text #h/yellow", pageTitle: "p.pdf" };
  };
  host.coversBlock = () => true;
  const session = acquireSession("b1", { host, linkDelay: 0, raf: (fn) => fn(), settings: { "graph-links": "off" } });
  const again = acquireSession("b1", { host, linkDelay: 0, settings: { "graph-links": "off" } });
  assert.equal(again, session);
  assert.equal(host.stats.watches, 1);
  assert.equal(props, 1);
  session.pauseWatches();
  assert.equal(host.stats.watches, 1, "the other mount still shows this board");
  again.pauseWatches();
  assert.equal(host.stats.watches, 0);
  const board = session.board;
  board.sentinel = "cache";
  session.resumeWatches();
  assert.equal(session.board, board);
  assert.equal(props, 1);
  assert.equal(host.stats.watches, 1);
});
