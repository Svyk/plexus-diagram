// P8 U2: derived links read the refs index and one pull_many of the sources instead of the big datalog join
// (live MAIN: 762-1,294 ms per 120 targets → 34-61 ms). Same rows as linksQuery().
import assert from "node:assert/strict";
import test from "node:test";
import { createHost } from "../src/host/roam.js";
import { acquireSession, resetSessions } from "../src/session.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";

function seed(fake) {
  fake.seedPage({ title: "A", uid: "pageA", children: [
    { uid: "sA1", string: "Causes:: [[B]]" },
    { uid: "sA2", string: "outer", children: [{ uid: "sA3", string: "see [[C]] and [[B]]" }] },
    { uid: "sA4", string: "self [[A]]" },
    { uid: "attrA", string: "Owner::", children: [{ uid: "sA5", string: "[[C]]" }] },
  ] });
  fake.seedPage({ title: "B", uid: "pageB" });
  fake.seedPage({ title: "C", uid: "pageC" });
  fake.seedPage({ title: "Z", uid: "pageZ", children: [
    { uid: "blkX", string: "a block card", children: [{ uid: "sX1", string: "[[C]]" }] },
  ] });
  fake.seedPage({ title: "D", uid: "pageD", children: [{ uid: "sD1", string: "[[B]] elsewhere" }] });
  fake.seedBoard({
    uid: "brd1",
    props: { plexus: { v: 2 } },
    children: [
      { uid: "c1", string: "[[A]]", props: { plexus: { x: 0, y: 0, w: 200, h: 100 } } },
      { uid: "c2", string: "[[B]]", props: { plexus: { x: 300, y: 0, w: 200, h: 100 } } },
      { uid: "c3", string: "[[C]]", props: { plexus: { x: 600, y: 0, w: 200, h: 100 } } },
      { uid: "c4", string: "((blkX))", props: { plexus: { x: 900, y: 0, w: 200, h: 100 } } },
      { uid: "c5", string: "inside board [[B]]", props: { plexus: { x: 0, y: 300, w: 200, h: 100 } } },
    ],
  });
  const sources = ["sA1", "sA3", "sA4", "sA5", "sX1", "sD1", "c1", "c2", "c3", "c5"];
  return sources;
}

function routeRefs(fake, host, sources) {
  const strings = new Map(sources.map((u) => [u, fake.pull(u)?.[":block/string"] ?? ""]));
  return fake.onQuery(/:find \?b \?src :in \$ \[\?b \.\.\.\] :where \[\?src :block\/refs \?b\]/, (_q, targets) => {
    const out = [];
    for (const [u, s] of strings) {
      const src = host.resolveEid({ uid: u });
      for (const m of s.matchAll(/\[\[([^\]]+)\]\]/g)) {
        const b = host.resolveEid({ title: m[1] });
        if (targets.includes(b)) out.push([b, src]);
      }
    }
    return out;
  });
}

test("host.linkRows: refs index + one pull_many give linksQuery()'s rows (page, parents, self, board and a===b excluded)", () => {
  const fake = createFakeRoam({ pullMany: true });
  const sources = seed(fake);
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  const route = routeRefs(fake, host, sources);
  const e = (ref) => host.resolveEid(ref);
  const [A, B, C, X] = [e({ title: "A" }), e({ title: "B" }), e({ title: "C" }), e({ uid: "blkX" })];
  const board = e({ uid: "brd1" });
  fake.pullLog = [];
  const rows = host.linkRows(board, new Set([A, B, C, X]), [A, B, C, X]);
  const got = rows.map((r) => r.slice(0, 4).join("|")).sort();
  const want = [
    [A, B, "sA1", "Causes:: [[B]]"],
    [A, B, "sA3", "see [[C]] and [[B]]"],
    [A, C, "sA3", "see [[C]] and [[B]]"],
    [A, C, "sA5", "[[C]]"],
    [X, C, "sX1", "[[C]]"],
  ].map((r) => r.join("|")).sort();
  const parentOf = new Map(rows.map((r) => [r[2], r[4]]));
  assert.equal(parentOf.get("sA3"), "outer");
  assert.equal(parentOf.get("sA5"), "Owner::");
  assert.equal(parentOf.get("sX1"), "a block card");
  assert.deepEqual(got, want);
  assert.equal(route.calls.length, 1, "one refs query");
  assert.equal(fake.pullLog.filter((p) => p.many).length, 1, "one pull_many of the sources");
});

test("host.linkRows without pull_many falls back to linksQuery()", () => {
  const fake = createFakeRoam();
  seed(fake);
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  const seen = [];
  fake.setQ((q, ...inputs) => { seen.push({ q: String(q), inputs }); return [[1, 2, "s", "x"]]; });
  const rows = host.linkRows(9, new Set([1, 2]), [2]);
  assert.deepEqual(rows, [[1, 2, "s", "x"]]);
  assert.match(seen[0].q, /:in \$ \?board \[\?a \.\.\.\] \[\?b \.\.\.\]/);
  assert.deepEqual(seen[0].inputs, [9, [1, 2], [2]]);
});

test("session links go through host.linkRows and publish the derived links", async () => {
  const fake = createFakeRoam({ pullMany: true });
  const sources = seed(fake);
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  routeRefs(fake, host, sources);
  const calls = [];
  const orig = host.linkRows.bind(host);
  host.linkRows = (...args) => { calls.push(args); return orig(...args); };
  let parentReads = 0;
  const ps = host.parentString.bind(host);
  host.parentString = (u) => { parentReads += 1; return ps(u); };
  try {
    const session = acquireSession("brd1", { host });
    session.setLinkMode("all");
    const keep = setInterval(() => {}, 10);
    try { await session.refreshLinks(); } finally { clearInterval(keep); }
    assert.ok(calls.length >= 1);
    const keys = session.links.map((l) => l.key).sort();
    assert.deepEqual(keys, ["c1->c2", "c1->c3", "c4->c3"]);
    // The parent string came with the rows: a source under a bare attribute names the link, no parentString read.
    assert.ok(session.links.find((l) => l.key === "c1->c3").labels.includes("Owner"));
    assert.equal(parentReads, 0);
    session.release();
  } finally {
    resetSessions();
  }
});
