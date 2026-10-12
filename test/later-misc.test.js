// WO N (Later list from the 3.26 hunt): N3 semantic errors, K3 panel refresh timer, F1 filter-browse cache,
// C8 gutter pill on scroll.
import assert from "node:assert/strict";
import test from "node:test";

import { createSemantic, SEM_RETRY_MS, SEM_TTL_MS } from "../src/host/semantic.js";
import { createPanel } from "../src/view/panel.js";
import { createHost } from "../src/host/roam.js";
import { createPartGutter } from "../src/view/part-gutter.js";
import { createDomStub } from "./fixtures/dom-stub.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

test("N3: a semantic search that throws keeps the stale rows and is retried after about 30 s", async () => {
  let clock = 1000;
  let fail = false;
  let calls = 0;
  const api = { data: { semanticSearchEnabled: () => true, async: { semanticSearch: async () => { calls += 1; if (fail) throw new Error("down"); return [{ type: "block", uid: "u1" }]; } } } };
  const sem = createSemantic({ api: () => api, now: () => clock });
  assert.deepEqual(await sem.search("spores"), [{ type: "block", uid: "u1" }]);
  clock += SEM_TTL_MS + 1;
  fail = true;
  let fresh = null;
  assert.deepEqual(await sem.search("spores", { onFresh: (d) => { fresh = d; } }), [{ type: "block", uid: "u1" }], "stale rows at once");
  await tick();
  assert.deepEqual(fresh, [{ type: "block", uid: "u1" }], "the failed refresh keeps the good rows");
  assert.deepEqual(sem.peek("spores").data, [{ type: "block", uid: "u1" }]);
  assert.equal(sem.peek("spores").stale, false);
  clock += SEM_RETRY_MS + 1;
  assert.equal(sem.peek("spores").stale, true, "retried after the short wait, not 5 minutes");
  // A first search that throws caches no answer for 5 minutes either.
  assert.deepEqual(await sem.search("new words"), []);
  const before = calls;
  clock += SEM_RETRY_MS + 1;
  fail = false;
  await sem.search("new words");
  await tick();
  assert.equal(calls, before + 1, "asked again after the retry wait");
  assert.deepEqual(await sem.search("new words"), [{ type: "block", uid: "u1" }]);
});

test("K3: closing the panel cancels a pending quiet re-search", async () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const root = stub.document.createElement("div");
    root.className = "pxd-root";
    stub.document.body.append(root);
    const pending = [];
    const timers = {
      later: (fn, ms) => { const job = { fn, ms, cancelled: false }; pending.push(job); return () => { job.cancelled = true; }; },
      frame: () => () => {},
    };
    const panel = createPanel({ doc: stub.document, root, host: { librarySearch: () => ({ rows: [], queries: [] }) }, timers, on: {} });
    panel.open("search");
    const input = root.querySelector(".pxd-panel__input");
    input.value = "spores";
    stub.dispatch(input, "keydown", { key: "Enter" });
    await tick();
    pending.length = 0;
    panel.refreshSearch();
    const job = pending.find((j) => j.ms === 300);
    assert.ok(job, "a quiet re-search is queued");
    panel.close();
    assert.equal(job.cancelled, true);
    panel.dispose();
  } finally {
    restore();
  }
});

test("F1: \"Not on any board\" browse results are not served from the cache after a card is added", async () => {
  const fake = createFakeRoam();
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  const t = Date.now();
  const node = { ":db/id": 2, ":block/uid": "b1", ":block/string": "a note", ":block/page": { ":node/title": "Alpha" }, ":create/time": t - 1000, ":edit/time": t - 500 };
  fake.api.data.pull_many = (pattern, eids) => eids.map(() => node);
  const browse = fake.onQuery(/^\[:find \?b \?t/, () => [[2, t - 500]]);
  host.filterBrowse({ days: 7, orphan: true }, 40, { sort: "edited" });
  host.filterBrowse({ days: 7 }, 40, { sort: "edited" });
  assert.equal(browse.calls.length, 2);
  host.filterBrowse({ days: 7, orphan: true }, 40, { sort: "edited" });
  assert.equal(browse.calls.length, 2, "cached while nothing changed");
  await host.createPage({ uid: "pgBoardX1", title: "Board X" });
  await host.createBlock({ parentUid: "pgBoardX1", string: "((b1))" });
  host.filterBrowse({ days: 7, orphan: true }, 40, { sort: "edited" });
  assert.equal(browse.calls.length, 3, "a block made since: Not on any board reads again");
  host.filterBrowse({ days: 7 }, 40, { sort: "edited" });
  assert.equal(browse.calls.length, 3, "other filter sets keep their cache");
});

test("C8: the part gutter pill hides when any scroller in the document moves, and stops listening once hidden", () => {
  const stub = createDomStub();
  const restore = stub.install();
  try {
    const doc = stub.document;
    const pane = doc.createElement("div");
    const scroller = doc.createElement("div");
    doc.body.append(pane, scroller);
    const gutter = createPartGutter({ doc, mount: pane, onCopy: () => true });
    gutter.intent({ id: "p1", type: "para" }, { left: 300, top: 120, right: 500, bottom: 160 }, { immediate: true, host: { left: 0, top: 0, right: 1000, bottom: 800 } });
    assert.equal(gutter.current()?.id, "p1");
    stub.dispatch(scroller, "scroll");
    assert.equal(gutter.current(), null, "the part scrolled away: the pill goes");
    const count = () => [...(doc.listeners?.get("scroll")?.values() || [])].length;
    assert.equal(count(), 0, "no document scroll listener while hidden");
    gutter.dispose();
  } finally {
    restore();
  }
});
