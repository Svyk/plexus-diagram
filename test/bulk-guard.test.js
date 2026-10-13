// F12: one transaction that plans hundreds of Roam writes asks first, and thousands are refused. Duplicating one big
// section of the PhD main board was ~18.5k creates and select-all Cmd+D ~28k: the size that wedged Roam's sync queue
// for 30 hours on 2026-10-12.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";
import { BULK_CONFIRM_WRITES, BULK_REFUSE_WRITES, acquireSession, resetSessions } from "../src/session.js";
import "../src/session-clip.js";

afterEach(() => resetSessions());

function setup(cards, confirmBulk) {
  const fake = createFakeRoam({ echoDelay: 0 });
  const kids = Array.from({ length: cards }, (_, i) => ({ uid: `c${i}`, string: `card ${i}`, props: { plexus: { x: (i % 50) * 10, y: Math.floor(i / 50) * 10, w: 100, h: 50 } } }));
  fake.seedBoard({ uid: "b1", props: { plexus: { v: 2 } }, children: [{ uid: "s1", string: "Section", props: { plexus: { type: "section", x: 0, y: 0, w: 2000, h: 2000 } }, children: kids }] });
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  const toasts = [];
  const session = acquireSession("b1", { host, raf: (fn) => fn(), linkDelay: 0, settings: { "graph-links": "off" }, confirmBulk });
  session.on("toast", (t) => toasts.push(t.message));
  return { fake, host, session, toasts };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

test("the thresholds are the sizes that hurt Roam's sync", () => {
  assert.ok(BULK_CONFIRM_WRITES >= 500 && BULK_CONFIRM_WRITES <= 700);
  assert.ok(BULK_REFUSE_WRITES >= 2500 && BULK_REFUSE_WRITES <= 3500);
});

test("a duplicate under the confirm line writes without asking", async () => {
  const asked = [];
  const { fake, session } = setup(100, (n) => { asked.push(n); return false; });
  await session.duplicateItems(["s1"]);
  await settle();
  assert.deepEqual(asked, []);
  assert.ok(fake.writesLog().length >= 101, `writes: ${fake.writesLog().length}`);
});

test("a duplicate over the confirm line asks; a refusal writes nothing and the board is unchanged", async () => {
  const asked = [];
  const { fake, session, toasts } = setup(BULK_CONFIRM_WRITES + 50, (n) => { asked.push(n); return false; });
  const before = session.board.items.size;
  const made = await session.duplicateItems(["s1"]);
  await settle();
  assert.equal(asked.length, 1);
  assert.ok(asked[0] > BULK_CONFIRM_WRITES, `asked for ${asked[0]} writes`);
  assert.deepEqual(made, []);
  assert.equal(fake.writesLog().length, 0);
  assert.equal(session.board.items.size, before, "the optimistic copy is gone again");
  assert.ok(toasts.some((m) => /cancel/i.test(m)), toasts.join(" | "));
});

test("a confirmed duplicate over the line writes", async () => {
  const { fake, session } = setup(BULK_CONFIRM_WRITES + 50, () => true);
  await session.duplicateItems(["s1"]);
  await settle();
  assert.ok(fake.writesLog().length > BULK_CONFIRM_WRITES, `writes: ${fake.writesLog().length}`);
});

test("a transaction over the refuse line is refused even when confirmed", async () => {
  const asked = [];
  const { fake, session, toasts } = setup(BULK_REFUSE_WRITES + 100, (n) => { asked.push(n); return true; });
  const before = session.board.items.size;
  await session.duplicateItems(["s1"]);
  await settle();
  assert.deepEqual(asked, []);
  assert.equal(fake.writesLog().length, 0);
  assert.equal(session.board.items.size, before);
  assert.ok(toasts.some((m) => /refused|too many/i.test(m)), toasts.join(" | "));
});
