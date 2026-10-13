import assert from "node:assert/strict";
import test, { afterEach, mock } from "node:test";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { SPLIT_HOLD_MS, WRITE_BURST, createHost, createWritePacer } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";

afterEach(() => resetSessions());

const SECTIONS = 20, CARDS = 60;
function seedBoard(uid, prefix) {
  const children = [];
  for (let s = 0; s < SECTIONS; s += 1) {
    const kids = [];
    for (let c = 0; c < CARDS; c += 1) kids.push({ uid: `${prefix}c${s}x${c}`, string: `card ${s}.${c}`, props: { plexus: { type: "card", x: c * 10, y: 0, w: 200, h: 100 } }, children: [{ uid: `${prefix}k${s}x${c}`, string: "kid" }] });
    children.push({ uid: `${prefix}s${s}`, string: `Section ${s}`, props: { plexus: { type: "section", x: 0, y: s * 1000, w: 900, h: 800 } }, children: kids });
  }
  return { uid, props: { plexus: { v: 2 } }, children };
}
function setup() {
  const fake = createFakeRoam({ echoDelay: 1 });
  fake.roamWatch = true;
  fake.seedBoard(seedBoard("main", "m"));
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  return { fake, host };
}

test("P7-1: watch calls count toward the cap, never toward the write burst gap", async () => {
  let t = 0;
  const waits = [];
  const pacer = createWritePacer({ now: () => t, sleep: async (ms) => { waits.push(ms); t += ms; }, burst: 5, gapMs: 100, cap: 10 });
  for (let i = 0; i < 6; i += 1) pacer.note();
  for (let i = 0; i < 4; i += 1) await pacer.pace();
  assert.deepEqual(waits, [], "4 writes after 6 watch calls go at once");
  assert.equal(pacer.recent, 10);
  await pacer.pace();
  assert.equal(waits[0], 60000, "the cap still counts watch calls");
});

test("P7-1: 30 writes right after 200+ watch calls on a big board resolve without sleeping", async () => {
  const { fake, host } = setup();
  host.pullBoard("main");
  host.watchBoard("main", () => {});
  for (let i = 0; i < WRITE_BURST; i += 1) host.watchContent(`mc${i % SECTIONS}x${Math.floor(i / SECTIONS)}`);
  await fake.flush();
  const t0 = Date.now();
  await Promise.all(Array.from({ length: 30 }, (_, i) => host.updateString(`mc${i % SECTIONS}x59`, `moved ${i}`)));
  const ms = Date.now() - t0;
  assert.ok(ms < 500, `30 writes took ${ms} ms`);
});
