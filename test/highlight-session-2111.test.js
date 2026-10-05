// PDF-2: a highlight tag change rebuilds the card colour and does not write.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";

afterEach(() => resetSessions());

const HL = "hlblock01";
const PLAIN = "plain0001";
const HL_PROPS = {
  "pdf-highlight": {
    type: "text",
    content: { text: "selected passage" },
    position: { boundingRect: { pageNumber: 2 } },
  },
};

function setup() {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  fake.seedBoard({
    uid: "b1",
    props: { plexus: { v: 2 } },
    children: [
      { uid: "c1", string: `((${HL}))`, props: { plexus: { x: 0, y: 0, w: 280, h: 160 } } },
      { uid: "c2", string: `((${HL}))`, props: { plexus: { x: 400, y: 0, w: 280, h: 160 } } },
      { uid: "c3", string: `((${PLAIN}))`, props: { plexus: { x: 800, y: 0, w: 280, h: 160 } } },
    ],
  });
  const strings = new Map([
    [HL, "selected passage #h/yellow"],
    [PLAIN, "a note #h/green"],
  ]);
  const readString = host.blockString.bind(host);
  host.blockString = (id) => (strings.has(id) ? strings.get(id) : readString(id));
  host.blockProps = (id) => {
    if (id === HL) return { props: HL_PROPS, string: strings.get(id), pageTitle: "Risk model.pdf" };
    if (id === PLAIN) return { props: {}, string: strings.get(id), pageTitle: "" };
    return null;
  };
  const watches = [];
  host.watchBlock = (id, cb) => {
    const rec = { id, cb, disposed: false };
    watches.push(rec);
    return () => { rec.disposed = true; };
  };
  const session = acquireSession("b1", {
    host,
    raf: (fn) => fn(),
    linkDelay: 0,
    settings: { "graph-links": "off" },
  });
  fake.clearLog();
  return { fake, host, session, strings, watches };
}

test("a highlight tag change updates the card colour and does not write", () => {
  const { fake, host, session, strings, watches } = setup();
  const card = session.board.items.get("c1");
  const twin = session.board.items.get("c2");
  const plain = session.board.items.get("c3");
  assert.equal(card.kind, "highlight");
  assert.equal(card.target.kind, "block");
  assert.equal(card.target.uid, HL);
  assert.equal(card.highlight.color, "yellow");
  assert.equal(card.color, undefined);
  assert.equal(twin.highlight.color, "yellow");
  assert.equal(plain.kind, "block");
  assert.equal(plain.highlight, undefined);
  assert.deepEqual(watches.map((w) => w.id), [HL]);

  strings.set(HL, "selected passage #h/green");
  watches[0].cb();

  assert.equal(session.board.items.get("c1").highlight.color, "green");
  assert.equal(session.board.items.get("c2").highlight.color, "green");
  assert.equal(session.board.items.get("c1").color, undefined);
  assert.equal(session.board.items.get("c1").kind, "highlight");
  assert.equal(session.board.items.get("c1").target.uid, HL);
  assert.equal(watches.length, 1);
  assert.equal(watches[0].disposed, false);
  assert.equal(fake.writesLog().length, 0);
  assert.equal(host.stats.writes, 0);

  session.release();
  assert.equal(watches[0].disposed, true);
});
