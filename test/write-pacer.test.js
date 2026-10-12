import test from "node:test";
import assert from "node:assert/strict";
import { createWritePacer, isRateLimitError, createHost } from "../src/host/roam.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";

function clock() {
  let t = 1000;
  const slept = [];
  return { now: () => t, sleep: async (ms) => { slept.push(ms); t += ms; }, slept, advance: (ms) => { t += ms; } };
}

test("the pacer lets a burst through, then spaces writes, and never passes the per-minute cap", async () => {
  const c = clock();
  const p = createWritePacer({ now: c.now, sleep: c.sleep, burst: 5, gapMs: 100, cap: 8 });
  for (let i = 0; i < 5; i += 1) await p.pace();
  assert.deepEqual(c.slept, []);
  for (let i = 0; i < 3; i += 1) await p.pace();
  assert.deepEqual(c.slept, [100, 100, 100]);
  await p.pace();
  assert.equal(c.slept.length, 4);
  assert.ok(c.slept[3] > 59000, `waited out the window: ${c.slept[3]}`);
});

test("saturate makes the next write wait a full window", async () => {
  const c = clock();
  const p = createWritePacer({ now: c.now, sleep: c.sleep, burst: 5, gapMs: 100, cap: 8 });
  await p.pace();
  p.saturate();
  await p.pace();
  assert.ok(c.slept[0] >= 60000);
});

test("Roam's refusal text is recognised", () => {
  assert.equal(isRateLimitError(new Error("roamAlphaApi maximum mutation rate limit exceeded")), true);
  assert.equal(isRateLimitError(new Error("Block already exists")), false);
});

test("a host write refused at the rate cap is retried once", async () => {
  const fake = createFakeRoam();
  fake.seedPage({ title: "Pace", uid: "root" });
  let calls = 0;
  const create = fake.api.data.block.create.bind(fake.api.data.block);
  fake.api.data.block.create = async (args) => {
    calls += 1;
    if (calls === 1) throw new Error("roamAlphaApi maximum mutation rate limit exceeded");
    return create(args);
  };
  const realSet = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => realSet(fn, 0);
  try {
    const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
    await host.createBlock({ parentUid: "root", uid: "newBlk01", string: "x" });
    assert.equal(calls, 2);
  } finally {
    globalThis.setTimeout = realSet;
  }
});
