import assert from "node:assert/strict";
import test from "node:test";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";

test("a board with many card refs reads its link rows in idle slices and publishes once", async () => {
  const fake = createFakeRoam();
  const children = [];
  for (let i = 0; i < 300; i += 1) {
    fake.seedPage({ title: `P${i}`, uid: `page${String(i).padStart(5, "0")}` });
    children.push({ uid: `card${String(i).padStart(5, "0")}`, string: `[[P${i}]]`, props: { plexus: { x: (i % 20) * 250, y: Math.floor(i / 20) * 150, w: 200, h: 100 } } });
  }
  fake.seedBoard({ uid: "bigLinks1", props: { plexus: { v: 2 } }, children });
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  const sizes = [];
  const q = host.q.bind(host);
  host.q = (query, ...inputs) => {
    if (String(query).includes(":in $ ?board [?a ...] [?b ...]")) sizes.push(inputs[2].length);
    return q(query, ...inputs);
  };
  const prevRic = globalThis.requestIdleCallback;
  const prevRaf = globalThis.requestAnimationFrame;
  globalThis.requestIdleCallback = (fn) => setTimeout(() => fn({ timeRemaining: () => 10 }), 0);
  globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(0), 0);
  try {
    const session = acquireSession("bigLinks1", { host });
    const keep = setInterval(() => {}, 10);
    try { await session.refreshLinks(); } finally { clearInterval(keep); }
    assert.deepEqual(sizes, [120, 120, 60]);
    session.release();
  } finally {
    globalThis.requestIdleCallback = prevRic;
    globalThis.requestAnimationFrame = prevRaf;
    resetSessions();
  }
});
