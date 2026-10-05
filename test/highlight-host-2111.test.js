import test from "node:test";
import assert from "node:assert/strict";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";

const PROPS_PATTERN = "[:block/string :block/props {:block/page [:node/title]}]";
const WATCH_PATTERN = "[:block/string]";
const HIGHLIGHT_STRING = "selected passage #h/yellow {{[[pdf]]: https://example.test/papers/Risk%20model.pdf}}";

function setup() {
  const fake = createFakeRoam();
  const props = {
    ":pdf-highlight": {
      ":type": "text",
      ":position": { ":boundingRect": { ":pageNumber": 3 } },
    },
  };
  const pulls = [];
  const watches = [];
  const queries = [];
  const data = fake.api.data;
  const add = data.addPullWatch.bind(data);
  const remove = data.removePullWatch.bind(data);
  data.pull = (pattern, entity) => {
    pulls.push([pattern, entity]);
    if (Array.isArray(entity) && entity[1] === "hl01") {
      return {
        ":block/string": HIGHLIGHT_STRING,
        ":block/props": props,
        ":block/page": { ":node/title": "Risk model.pdf" },
      };
    }
    return null;
  };
  data.addPullWatch = (pattern, entity, cb) => {
    watches.push({ pattern, entity, cb });
    return add(pattern, entity, cb);
  };
  data.removePullWatch = (pattern, entity, cb) => {
    const i = watches.findIndex((w) => w.cb === cb && w.entity === entity && w.pattern === pattern);
    if (i >= 0) watches.splice(i, 1);
    return remove(pattern, entity, cb);
  };
  data.q = (...args) => { queries.push(args); return []; };
  data.fast.q = (...args) => { queries.push(args); return []; };
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  return { fake, host, pulls, watches, queries, props };
}

test("blockProps returns the page title and the props object", () => {
  const { host, pulls, queries, props } = setup();
  const got = host.blockProps("hl01");
  assert.equal(pulls.length, 1);
  assert.equal(pulls[0][0], PROPS_PATTERN);
  assert.equal(pulls[0][0].includes("url"), false);
  assert.deepEqual(pulls[0][1], [":block/uid", "hl01"]);
  assert.equal(got.pageTitle, "Risk model.pdf");
  assert.equal(got.props, props);
  assert.equal(got.string, HIGHLIGHT_STRING);
  assert.equal(queries.length, 0);
  assert.equal(host.stats.writes, 0);
});

test("blockProps returns null when the block is missing", () => {
  const { host, pulls, queries } = setup();
  assert.equal(host.blockProps("missing"), null);
  assert.equal(pulls.length, 1);
  assert.equal(pulls[0][0], PROPS_PATTERN);
  assert.deepEqual(pulls[0][1], [":block/uid", "missing"]);
  assert.equal(queries.length, 0);
  assert.equal(host.stats.writes, 0);
});

test("watchBlock registers one watch and the disposer removes it", () => {
  const { fake, host, watches, queries, props } = setup();
  const pull = {
    ":block/uid": "hl01",
    ":block/string": "selected passage #h/green",
    ":block/props": props,
    ":block/page": { ":node/title": "Risk model.pdf" },
  };
  const seen = [];
  const off = host.watchBlock("hl01", (got) => seen.push(got));
  assert.equal(watches.length, 1);
  assert.equal(fake.watchCount(), 1);
  assert.equal(host.stats.watches, 1);
  assert.equal(watches[0].pattern, WATCH_PATTERN);
  assert.equal(watches[0].entity, '[:block/uid "hl01"]');
  watches[0].cb({ ":block/string": "before" }, pull);
  assert.deepEqual(seen, [pull]);
  off();
  off();
  assert.equal(watches.length, 0);
  assert.equal(fake.watchCount(), 0);
  assert.equal(host.stats.watches, 0);
  assert.equal(queries.length, 0);
  assert.equal(host.stats.writes, 0);
});
