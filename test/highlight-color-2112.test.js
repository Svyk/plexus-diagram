// PDF-6: setHighlightColor rewrites the #h tag on the highlight block. One string op. No props.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";
import { rewriteHighlightTag } from "../src/model/highlight.js";
import { acquireSession, resetSessions } from "../src/session.js";

afterEach(() => resetSessions());

const HL = "hlblock01";
const YELLOW = "selected passage #h/yellow";
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
  fake.seedPage({
    title: "Risk model.pdf",
    uid: "pg1",
    children: [{ uid: HL, string: YELLOW, props: HL_PROPS }],
  });
  fake.seedBoard({
    uid: "b1",
    props: { plexus: { v: 2 } },
    children: [
      { uid: "c1", string: `((${HL}))`, props: { plexus: { x: 0, y: 0, w: 280, h: 160 }, keep: 1 } },
    ],
  });
  const session = acquireSession("b1", {
    host,
    raf: (fn) => fn(),
    linkDelay: 0,
    settings: { "graph-links": "off" },
  });
  const stringCalls = [];
  const colorCalls = [];
  const setString = session.setString.bind(session);
  const setColor = session.setColor.bind(session);
  session.setString = (...args) => { stringCalls.push(args); return setString(...args); };
  session.setColor = (...args) => { colorCalls.push(args); return setColor(...args); };
  fake.clearLog();
  return { fake, host, session, stringCalls, colorCalls };
}

test("yellow becomes green in one string op and props stay untouched", async () => {
  const { fake, session, stringCalls, colorCalls } = setup();
  const cardProps = fake.props("c1");
  const blockProps = fake.props(HL);
  assert.equal(session.board.items.has(HL), false);
  assert.equal(session.board.items.get("c1").color, undefined);

  await session.setHighlightColor(HL, "green");
  await session.idle();

  const log = fake.writesLog();
  assert.equal(log.length, 1);
  assert.deepEqual(log[0], ["update", HL, { string: rewriteHighlightTag(YELLOW, "green") }]);
  assert.equal(fake.block(HL).string, "selected passage #h/green");
  assert.deepEqual(fake.props(HL), blockProps);
  assert.deepEqual(fake.props("c1"), cardProps);
  assert.equal(session.board.items.get("c1").color, undefined);
  assert.equal(stringCalls.length, 0);
  assert.equal(colorCalls.length, 0);
  session.release();
});

test("teal does not write", async () => {
  const { fake, session, stringCalls, colorCalls } = setup();
  await session.setHighlightColor(HL, "teal");
  await session.idle();
  assert.equal(fake.writesLog().length, 0);
  assert.equal(fake.block(HL).string, YELLOW);
  assert.equal(stringCalls.length, 0);
  assert.equal(colorCalls.length, 0);
  session.release();
});

test("a null blockString writes nothing", async () => {
  const { fake, host, session } = setup();
  host.blockString = () => null;
  await session.setHighlightColor(HL, "green");
  await session.idle();
  assert.equal(fake.writesLog().length, 0);
  assert.equal(fake.block(HL).string, YELLOW);
  session.release();
});
