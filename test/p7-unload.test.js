// P7-5 in its own file: other tests' hosts keep idle prime chains going through setTimeout, which would land in
// this test's timer count.
import assert from "node:assert/strict";
import test from "node:test";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";

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

test("P7-5: unload leaves 0 registered watches and 0 pending host timers", async () => {
  const pending = new Set();
  const realSet = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  globalThis.setTimeout = (fn, ms, ...a) => {
    const id = realSet(() => { pending.delete(id); fn(...a); }, ms); id.stack = new Error().stack;
    // Host timers (hold, arm, sweep, idle parts) are 250 ms or longer; fake-roam echoes are not.
    if (ms >= 250) pending.add(id);
    return id;
  };
  globalThis.clearTimeout = (id) => { pending.delete(id); realClear(id); };
  let fake;
  let host;
  try {
    ({ fake, host } = setup());
    host.pullBoard("main");
    acquireSession("main", { host, linkDelay: 0 });
    const offs = Array.from({ length: 30 }, (_, i) => host.watchContent(`mc${i % SECTIONS}x${i % 7}`));
    await fake.flush();
    for (const off of offs.slice(0, 20)) off();
    host.watchBlock("blkA", () => {});
    resetSessions();
    host.dispose();
    assert.equal(fake.watchList().length, 0, "every pull watch removed");
    assert.equal(host.splitStats?.("main") ?? null, null);
  } finally {
    globalThis.setTimeout = realSet;
    globalThis.clearTimeout = realClear;
  }
  const left = [...pending].map((id) => id.stack);
  for (const id of pending) realClear(id);
  assert.deepEqual(left, [], "no host timer left");
});

