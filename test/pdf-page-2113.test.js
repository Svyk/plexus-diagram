import test from "node:test";
import assert from "node:assert/strict";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";

const URL = "https://example.test/papers/Risk%20model.pdf";

function setup(pullResult) {
  const fake = createFakeRoam();
  const pulls = [];
  const queries = [];
  const fetches = [];
  const data = fake.api.data;
  data.pull = (pattern, entity) => {
    pulls.push([pattern, entity]);
    return typeof pullResult === "function" ? pullResult(pattern, entity) : pullResult;
  };
  data.q = (...args) => { queries.push(args); return [["block"]]; };
  data.fast.q = (...args) => { queries.push(args); return [["block"]]; };
  fake.setFileGet((arg) => { fetches.push(arg); return { bytes: new Uint8Array() }; });
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  return { fake, host, pulls, queries, fetches };
}

test("pdfPageUrl returns the pulled :pdf/url string", () => {
  const { host, pulls, queries, fetches } = setup({ ":pdf/url": URL });
  assert.equal(host.pdfPageUrl("pageUid01"), URL);
  assert.equal(pulls.length, 1);
  assert.equal(pulls[0][0], "[:pdf/url]");
  assert.equal(pulls[0][0].includes(":block/"), false);
  assert.deepEqual(pulls[0][1], [":block/uid", "pageUid01"]);
  assert.equal(queries.length, 0);
  assert.equal(fetches.length, 0);
  assert.equal(host.stats.writes, 0);
});

test("a missing :pdf/url attribute returns empty", () => {
  const { host, pulls, queries, fetches } = setup({ ":node/title": "Risk model.pdf" });
  assert.equal(host.pdfPageUrl("pageUid01"), "");
  assert.equal(pulls.length, 1);
  assert.equal(pulls[0][0], "[:pdf/url]");
  assert.deepEqual(pulls[0][1], [":block/uid", "pageUid01"]);
  assert.equal(queries.length, 0);
  assert.equal(fetches.length, 0);
  assert.equal(host.stats.writes, 0);
});

test("a null pull returns empty and does not query or fetch", () => {
  const { host, pulls, queries, fetches } = setup(null);
  assert.equal(host.pdfPageUrl("pageUid01"), "");
  assert.equal(pulls.length, 1);
  assert.equal(queries.length, 0);
  assert.equal(fetches.length, 0);
  assert.equal(host.stats.writes, 0);
});
