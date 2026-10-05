import test from "node:test";
import assert from "node:assert/strict";
import { createFakeRoam } from "./fixtures/fake-roam.js";
import { createHost } from "../src/host/roam.js";

const HL_PROPS = {
  ":pdf-highlight": {
    ":type": "text",
    ":position": { ":boundingRect": { ":pageNumber": 1 } },
  },
};

function setup() {
  const fake = createFakeRoam();
  const pulls = [];
  const queries = [];
  const data = fake.api.data;
  data.pull = (pattern, entity) => {
    pulls.push([pattern, entity]);
    if (Array.isArray(entity) && entity[1] === "page01") {
      return {
        ":block/uid": "page01",
        ":block/children": [{
          ":block/uid": "notes01",
          ":block/string": "Notes by [[Svy]]",
          ":block/order": 0,
          ":block/props": {},
          ":block/children": [{
            ":block/uid": "date01",
            ":block/string": "[[October 5th, 2026]]",
            ":block/order": 0,
            ":block/props": {},
            ":block/children": [
              {
                ":block/uid": "hl02",
                ":block/string": "second passage #h/green",
                ":block/order": 1,
                ":block/props": HL_PROPS,
              },
              {
                ":block/uid": "hl01",
                ":block/string": "first passage #h/yellow",
                ":block/order": 0,
                ":block/props": HL_PROPS,
              },
            ],
          }],
        }],
      };
    }
    return null;
  };
  data.q = (...args) => { queries.push(args); return []; };
  data.fast.q = (...args) => { queries.push(args); return []; };
  const host = createHost({ api: fake.api, storage: fake.storage, graph: "g" });
  return { host, pulls, queries };
}

test("two highlights under a date block come back", () => {
  const { host, pulls, queries } = setup();
  const tree = host.pdfHighlightTree("page01");
  assert.equal(pulls.length, 1);
  const pattern = pulls[0][0];
  assert.equal((pattern.match(/:block\/children/g) || []).length, 4);
  assert.equal(pattern.includes(":block/uid"), true);
  assert.equal(pattern.includes(":block/string"), true);
  assert.equal(pattern.includes(":block/order"), true);
  assert.equal(pattern.includes(":block/props"), true);
  assert.equal(pattern.includes(":pdf/url"), false);
  assert.equal(pattern.includes("url"), false);
  assert.deepEqual(pulls[0][1], [":block/uid", "page01"]);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].uid, "notes01");
  const date = tree[0].children[0];
  assert.equal(date.uid, "date01");
  assert.equal(date.string, "[[October 5th, 2026]]");
  assert.deepEqual(date.children.map((child) => child.uid), ["hl01", "hl02"]);
  assert.equal(date.children[0].string, "first passage #h/yellow");
  assert.equal(date.children[1].string, "second passage #h/green");
  assert.equal(date.children[0].props, HL_PROPS);
  assert.equal(date.children[1].props, HL_PROPS);
  assert.deepEqual(date.children[0].children, []);
  assert.deepEqual(date.children[1].children, []);
  assert.equal(queries.length, 0);
  assert.equal(host.stats.writes, 0);
});

test("a missing page is []", () => {
  const { host, pulls, queries } = setup();
  assert.deepEqual(host.pdfHighlightTree("missing"), []);
  assert.equal(pulls.length, 1);
  assert.equal(pulls[0][0].includes(":pdf/url"), false);
  assert.equal(pulls[0][0].includes("url"), false);
  assert.deepEqual(pulls[0][1], [":block/uid", "missing"]);
  assert.equal(queries.length, 0);
  assert.equal(host.stats.writes, 0);
});
