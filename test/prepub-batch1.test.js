import assert from "node:assert/strict";
import test from "node:test";

import { editorPastePlan } from "../src/model/clipboard.js";
import { FILTER_POLL_MS, createQueryFilter } from "../src/view/query-filter.js";
import { createTaskProbe } from "../src/long-tasks.js";

test("PXD-3: editorPastePlan reports how many lines past the cap were left out", () => {
  const text = Array.from({ length: 57 }, (_, i) => `line ${i}`).join("\n");
  const plan = editorPastePlan({ text, value: "", isRoot: true });
  assert.equal(plan.type, "blocks");
  assert.equal(1 + plan.children.length, 45);
  assert.equal(plan.dropped, 12);
  const small = editorPastePlan({ text: "a\nb\nc", value: "", isRoot: true });
  assert.equal(small.dropped, 0);
});

test("PXD-3: a query filter whose read threw still polls again", async () => {
  const due = [];
  const later = (fn, ms) => { due.push({ fn, ms }); return due.length; };
  let boom = true;
  const backend = { hits: () => { if (boom) throw new Error("slow"); return { uids: ["note00001"], partial: false }; } };
  const seen = [];
  const doc = { addEventListener() {}, removeEventListener() {}, activeElement: null };
  const f = createQueryFilter({ host: { blockString: () => "{{query: [[Alpha]]}}" }, doc, backend, later, cancel: () => {}, onResults: (r) => seen.push(r) });
  f.start({ queryUid: "qcard0001", cardUid: "qcard0001" });
  for (let i = 0; i < 20; i += 1) {
    const t = due.findIndex((d) => d.ms === 0);
    if (t >= 0) due.splice(t, 1)[0].fn(); else await new Promise((r) => setImmediate(r));
  }
  assert.equal(seen.at(-1)?.status, "error");
  assert.ok(due.some((d) => d.ms === FILTER_POLL_MS), "a poll is queued after the failed read");
  f.stop();
});

test("PXD-3: disposing a task probe disconnects its long-task observer", () => {
  let disconnected = 0;
  class PO { observe() {} disconnect() { disconnected += 1; } }
  const probe = createTaskProbe({ win: { PerformanceObserver: PO } });
  probe.observe();
  probe.dispose();
  assert.equal(disconnected, 1);
});
