// HUNT-2: a typing flush patches the open card and does not rebuild the board.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHost } from "../src/host/roam.js";
import { buildBoard, diffBoards } from "../src/model/board.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";

afterEach(() => resetSessions());

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function noteTree(string, child = "kid") {
  return {
    ":block/uid": "b1",
    ":block/string": "{{[[diagram]]}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": [{
      ":block/uid": "n1",
      ":block/string": string,
      ":block/order": 0,
      ":block/props": { ":plexus": { ":x": 0, ":y": 0, ":w": 200, ":h": 80 } },
      ":block/children": [{ ":block/uid": "k1", ":block/string": child, ":block/order": 0 }],
    }],
  };
}

test("diffBoards ignores child trees and still flags string, layout, and order", () => {
  const prev = buildBoard(noteTree("Note", "one"));
  const same = diffBoards(prev, buildBoard(noteTree("Note", "one")));
  assert.equal(same.structural, false);
  assert.equal(same.dirty.size, 0);

  const child = diffBoards(prev, buildBoard(noteTree("Note", "two")));
  assert.equal(child.structural, false);
  assert.equal(child.dirty.size, 0);

  const typed = diffBoards(prev, buildBoard(noteTree("Note!", "one")));
  assert.equal(typed.structural, false);
  assert.deepEqual([...typed.dirty], ["n1"]);

  const moved = noteTree("Note", "one");
  moved[":block/children"][0][":block/props"][":plexus"][":x"] = 40;
  const layout = diffBoards(prev, buildBoard(moved));
  assert.equal(layout.structural, false);
  assert.deepEqual([...layout.dirty], ["n1"]);

  const reordered = noteTree("Note", "one");
  reordered[":block/children"].push({
    ":block/uid": "n2",
    ":block/string": "Second",
    ":block/order": 1,
    ":block/props": { ":plexus": { ":x": 240, ":y": 0, ":w": 200, ":h": 80 } },
  });
  const pair = buildBoard(reordered);
  const swapped = noteTree("Note", "one");
  swapped[":block/children"].push({
    ":block/uid": "n2",
    ":block/string": "Second",
    ":block/order": 0,
    ":block/props": { ":plexus": { ":x": 240, ":y": 0, ":w": 200, ":h": 80 } },
  });
  swapped[":block/children"][0][":block/order"] = 1;
  const orderDiff = diffBoards(pair, buildBoard(swapped));
  assert.equal(orderDiff.structural, true);
  assert.ok(orderDiff.dirty.has("n1"));
  assert.ok(orderDiff.dirty.has("n2"));
});

function openHost() {
  const fake = createFakeRoam({ echoDelay: 0 });
  const reads = { pull: 0, q: 0 };
  const pull = fake.api.data.pull.bind(fake.api.data);
  const query = fake.api.data.q.bind(fake.api.data);
  const countQ = (...args) => { reads.q += 1; return query(...args); };
  fake.api.data.pull = (...args) => { reads.pull += 1; return pull(...args); };
  fake.api.data.q = countQ;
  fake.api.data.fast.q = countQ;
  fake.onQuery(/\(pull \?e/, (_text, uids) => {
    const ids = Array.isArray(uids) ? uids : [];
    return ids.map((id) => {
      const node = fake.pull(id);
      return node ? [node] : null;
    }).filter(Boolean);
  });
  const targets = [];
  for (let i = 0; i < 4; i++) targets.push({ uid: `t${i}`, string: `alpha ${i}` });
  fake.seedPage({ uid: "pg1", title: "Notes", children: targets });
  const children = targets.map((target, i) => ({
    uid: `c${i}`,
    string: `((${target.uid}))`,
    props: { plexus: { x: i * 40, y: 0, w: 200, h: 80 } },
  }));
  children.push({
    uid: "n1",
    string: "Hello",
    props: { plexus: { x: 0, y: 200, w: 200, h: 80 } },
    children: [{ uid: "k1", string: "kid" }],
  });
  fake.seedBoard({ uid: "b1", props: { plexus: { v: 2 } }, children });
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  let strings = 0;
  const readString = host.blockString.bind(host);
  host.blockString = (id) => { strings += 1; return readString(id); };
  const session = acquireSession("b1", {
    host,
    raf: (fn) => fn(),
    linkDelay: 0,
    settings: { "graph-links": "off" },
  });
  return { fake, host, session, reads, strings: () => strings, resetStrings: () => { strings = 0; } };
}

test("a flush with no relevant change makes no extra host reads", async () => {
  const { fake, session, reads, strings, resetStrings } = openHost();
  assert.equal(session.board.items.get("c0").kind, "block");
  await fake.flush();
  reads.pull = 0;
  reads.q = 0;
  resetStrings();
  await fake.api.data.block.update({ block: { uid: "c0", string: "((t0))" } });
  await fake.flush();
  assert.equal(reads.pull, 0);
  assert.equal(reads.q, 0);
  assert.equal(strings(), 4);
});

test("a typing flush on the edited card does not call buildBoard", async () => {
  const { fake, session, reads } = openHost();
  await fake.flush();
  reads.pull = 0;
  reads.q = 0;
  const events = [];
  session.on("change", (diff) => events.push(diff));
  session.setEditing("n1");
  const before = session.board;
  before.sentinel = "hunt-2";
  await fake.api.data.block.update({ block: { uid: "n1", string: "Hello!" } });
  await fake.flush();
  assert.equal(session.board, before);
  assert.equal(session.board.sentinel, "hunt-2");
  assert.equal(session.board.items.get("n1").string, "Hello!");
  assert.equal(session.board.items.get("n1").title, "Hello!");
  assert.equal(events.length, 1);
  assert.equal(events[0].structural, false);
  assert.deepEqual([...events[0].dirty], ["n1"]);
  assert.equal(reads.pull, 0);
  assert.equal(reads.q, 0);

  events.length = 0;
  await fake.api.data.block.update({ block: { uid: "k1", string: "kid!" } });
  await fake.flush();
  assert.equal(session.board, before);
  assert.equal(session.board.items.get("n1").content[0][":block/string"], "kid!");
  assert.equal(events.length, 1);
  assert.equal(events[0].structural, false);
  assert.ok(events[0].dirty.has("n1"));

  events.length = 0;
  await fake.api.data.block.update({ block: { uid: "c1", string: "((t1)) extra" } });
  await fake.flush();
  assert.notEqual(session.board, before);
  assert.equal(session.board.items.get("c1").string, "((t1)) extra");

  const live = session.board;
  session.setEditing("n1");
  await fake.api.data.block.update({ block: { uid: "n1", string: "((t0))" } });
  await fake.flush();
  assert.notEqual(session.board, live);
  assert.equal(session.board.items.get("n1").kind, "block");
});

test("setEditing(null) lets the next string flush rebuild", async () => {
  const { fake, session } = openHost();
  await fake.flush();
  session.setEditing("n1");
  session.setEditing(null);
  const before = session.board;
  await fake.api.data.block.update({ block: { uid: "n1", string: "after" } });
  await fake.flush();
  await sleep(20);
  assert.notEqual(session.board, before);
  assert.equal(session.board.items.get("n1").string, "after");
});
