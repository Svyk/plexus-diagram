import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHost, patternNeeds } from "../src/host/roam.js";
import { createFakeRoam } from "./fixtures/fake-roam.js";

// Roam's DataScript pull returns at most 1000 values of a ref-many attribute by default.
// Found 2026-10-12: a Connections block with 1,832 edge children pulled only 1,000.
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name.endsWith(".js")) out.push(path);
  }
  return out;
}

test("no pull pattern in src asks for :block/children, :block/_refs or :block/_parents without the limit form", () => {
  const bare = [];
  for (const file of walk("src")) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (/\{:block\/(children|_refs|_parents)\b/.test(line)) bare.push(`${file}:${i + 1}`);
    });
  }
  assert.deepEqual(bare, []);
});

// :block/page is cardinality-one: Roam's pull throws "Expected limit attribute having :db.cardinality/many" on
// (limit :block/_page nil), and the bare reverse is not capped (live: a 23,345-block page pulled 23,345). The throw
// sent every card-stat read to the slow datalog fallback.
test("no pull pattern in src puts the limit form on :block/_page", () => {
  const hits = [];
  for (const file of walk("src")) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (/\(limit :block\/_page\b/.test(line)) hits.push(`${file}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, []);
});

test("patternNeeds reads the limit form like the bare attribute", () => {
  assert.deepEqual(
    patternNeeds("[:block/uid {(limit :block/children nil) [:block/string {(limit :block/children nil) ...}]}]"),
    patternNeeds("[:block/uid {:block/children [:block/string {:block/children ...}]}]"),
  );
  assert.deepEqual(
    patternNeeds("[:node/title {(limit :block/_refs 50) [:block/uid]}]"),
    [{ attr: ":node/title" }, { key: ":block/_refs", sub: [{ attr: ":block/uid" }] }],
  );
});

test("a board with 1,500 direct children keeps all of them through pullBoard", () => {
  const fake = createFakeRoam();
  const kids = Array.from({ length: 1500 }, (_, i) => ({ uid: `k${String(i).padStart(5, "0")}`, string: `edge ${i}` }));
  const uid = fake.seedBoard({ uid: "boardCAP1", children: [{ uid: "connCAP01", string: "Connections", children: kids }] });
  assert.equal(fake.api.data.pull("[:block/uid {:block/children [:block/uid]}]", [":block/uid", "connCAP01"])[":block/children"].length, 1000);
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  const board = host.pullBoard(uid);
  const conn = board[":block/children"].find((c) => c[":block/uid"] === "connCAP01");
  assert.equal(conn[":block/children"].length, 1500);
});
