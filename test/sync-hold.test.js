// F10: a bulk transaction waits between batches while Roam's own sync dot says it is saving. Only the
// `.rm-sync__icon` class is read; Roam's IndexedDB is never opened.
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { SYNC_HOLD_BATCH, SYNC_HOLD_CAP_MS, createSyncHold } from "../src/host/sync-hold.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";

afterEach(() => resetSessions());

function dotDoc(initial) {
  const classes = new Set(initial ? [initial] : []);
  const icon = { classList: { contains: (c) => classes.has(c), toString: () => [...classes].join(" ") }, get className() { return [...classes].join(" "); } };
  const doc = { querySelector: (sel) => (sel === ".rm-sync__icon" && classes.size ? icon : null), defaultView: null };
  return { doc, set: (...c) => { classes.clear(); c.forEach((x) => classes.add(x)); } };
}

test("the dot's saving classes read as saving; synced and a missing dot do not", () => {
  const d = dotDoc("rm-sync__icon--saving-local");
  const hold = createSyncHold({ doc: d.doc });
  assert.equal(hold.saving(), true);
  d.set("rm-sync__icon--saving-remote");
  assert.equal(hold.saving(), true);
  d.set("rm-sync__icon--synced");
  assert.equal(hold.saving(), false);
  d.set();
  assert.equal(hold.saving(), null, "no dot: unknown");
});

test("wait returns at once when synced, unknown, or offline", async () => {
  const synced = dotDoc("rm-sync__icon--synced");
  assert.deepEqual(await createSyncHold({ doc: synced.doc, sleep: async () => { throw new Error("slept"); } }).wait(), { waited: 0, capped: false, held: false });
  const none = dotDoc("");
  assert.equal((await createSyncHold({ doc: none.doc, sleep: async () => { throw new Error("slept"); } }).wait()).held, false);
  const saving = dotDoc("rm-sync__icon--saving-local");
  assert.equal((await createSyncHold({ doc: saving.doc, online: () => false, sleep: async () => { throw new Error("slept"); } }).wait()).held, false, "offline fails open");
});

test("wait polls until the dot says synced and calls onHold once", async () => {
  const d = dotDoc("rm-sync__icon--saving-local");
  let t = 0;
  let polls = 0;
  const hold = createSyncHold({ doc: d.doc, now: () => t, sleep: async (ms) => { t += ms; polls += 1; if (polls === 3) d.set("rm-sync__icon--synced"); } });
  let held = 0;
  const out = await hold.wait({ onHold: () => { held += 1; } });
  assert.equal(out.held, true);
  assert.equal(out.capped, false);
  assert.equal(held, 1);
  assert.equal(polls, 3);
});

test("wait gives up after the cap", async () => {
  const d = dotDoc("rm-sync__icon--saving-remote");
  let t = 0;
  const hold = createSyncHold({ doc: d.doc, now: () => t, sleep: async (ms) => { t += ms; } });
  const out = await hold.wait();
  assert.equal(out.capped, true);
  assert.ok(out.waited >= SYNC_HOLD_CAP_MS && out.waited < SYNC_HOLD_CAP_MS + 1000);
});

test("a beforeunload guard is installed while held and removed after", async () => {
  const d = dotDoc("rm-sync__icon--saving-local");
  const listeners = new Set();
  const win = { addEventListener: (t, fn) => { if (t === "beforeunload") listeners.add(fn); }, removeEventListener: (t, fn) => { listeners.delete(fn); } };
  d.doc.defaultView = win;
  let polls = 0;
  const hold = createSyncHold({ doc: d.doc, sleep: async () => { polls += 1; assert.equal(listeners.size, 1, "guard installed while held"); if (polls === 2) d.set("rm-sync__icon--synced"); } });
  await hold.wait();
  assert.equal(listeners.size, 0);
  const guard = (() => { const g = {}; const fake = { addEventListener: (t, fn) => { g.fn = fn; }, removeEventListener() {} }; d.doc.defaultView = fake; return g; })();
  d.set("rm-sync__icon--saving-local");
  let n = 0;
  await createSyncHold({ doc: d.doc, sleep: async () => { n += 1; if (n === 1) { const ev = { prevented: false, preventDefault() { this.prevented = true; } }; guard.fn(ev); assert.equal(ev.prevented, true); d.set("rm-sync__icon--synced"); } } }).wait();
});

function sessionWith(hold, count) {
  const stub = createDomStub();
  const restore = stub.install();
  const fake = createFakeRoam({ echoDelay: 0 });
  fake.seedBoard({ uid: "b1", props: { plexus: { v: 2 } }, children: Array.from({ length: count }, (_, i) => ({ uid: `c${i}`, string: `card ${i}`, props: { plexus: { x: i * 10, y: 0, w: 200, h: 100 } } })) });
  const host = createHost({ api: fake.api, storage: stub.localStorage, graph: "g" });
  const session = acquireSession("b1", { host, raf: (fn) => fn(), syncHold: hold });
  return { fake, session, restore };
}

test("a 205-write transaction waits at each batch of 100, shows held, and a short one never waits", async () => {
  const waits = [];
  const hold = { wait: async ({ onHold } = {}) => { waits.push(1); onHold?.(); return { held: true, waited: 5, capped: false }; } };
  const { session, restore } = sessionWith(hold, 205);
  try {
    const states = [];
    session.on("sync", (s) => states.push(s));
    await session.commitMove(Array.from({ length: 205 }, (_, i) => `c${i}`), 3, 0);
    assert.equal(waits.length, 2, "after write 100 and after write 200");
    assert.ok(states.includes("held"), `states ${states.join(",")}`);
    assert.equal(states.at(-1), "idle");
    waits.length = 0;
    await session.commitMove(["c0", "c1", "c2"], 1, 0);
    assert.equal(waits.length, 0);
  } finally {
    restore();
  }
});

test("undo of a long action never waits", async () => {
  const waits = [];
  const hold = { wait: async () => { waits.push(1); return { held: false, waited: 0, capped: false }; } };
  const { session, restore } = sessionWith(hold, 105);
  try {
    await session.commitMove(Array.from({ length: 105 }, (_, i) => `c${i}`), 3, 0);
    assert.equal(waits.length, 1, "the forward write waited once, after write 100");
    waits.length = 0;
    await session.undo();
    assert.equal(waits.length, 0);
  } finally {
    restore();
  }
  assert.equal(SYNC_HOLD_BATCH, 100);
});
