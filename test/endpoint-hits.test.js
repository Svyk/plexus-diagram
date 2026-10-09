import test from "node:test";
import assert from "node:assert/strict";
import { endpointDisplayText, endpointHitsKey, endpointHitsOf } from "../src/model/endpoints.js";
import { chipText } from "../src/relchips.js";

const region = (uid, f) => ({ ":block/uid": uid, ":block/string": `{{[[plexus-region]]: k=img d=img00001 f=${f}}} Region 1` });

test("endpoint hits read every container, so a PDF with an old regions container and a new pins container shows both", () => {
  const nodes = [
    { ":block/uid": "c1", ":block/string": "{{[[plexus-regions]]}}", ":block/children": [
      { ":block/uid": "oldpin01", ":block/string": "{{[[plexus-region]]: k=pdf d=pdf00001 pg=6 f=0.1,0.2,0.3,0.04}} quote" },
    ] },
    { ":block/uid": "c2", ":block/string": "{{[[plexus-pins]]}}", ":block/children": [
      { ":block/uid": "newpin01", ":block/string": "{{[[plexus-pin]]: d=pdf00001 pg=6 f=0.5,0.4,0.15,0.01}} 4.2." },
    ] },
    { ":block/uid": "note0001", ":block/string": "plain child" },
  ];
  const hits = endpointHitsOf(nodes);
  assert.deepEqual(hits.regions, []);
  assert.deepEqual(hits.pins.map((p) => p.uid), ["oldpin01", "newpin01"]);
  assert.deepEqual(hits.pins[1].frac, [0.5, 0.4, 0.15, 0.01]);
  assert.deepEqual(endpointHitsOf(null), { regions: [], pins: [] });
});

test("the endpoint hits key changes when a region is added or reshaped, so the image card repaints its outlines", () => {
  // Live 2026-10-08: a region written by Connect showed no outline until the board remounted.
  const none = [];
  const one = [{ ":block/uid": "c1", ":block/string": "{{[[plexus-regions]]}}", ":block/children": [region("reg00001", "0.0689,0.625,0.4299,0.0815")] }];
  const moved = [{ ":block/uid": "c1", ":block/string": "{{[[plexus-regions]]}}", ":block/children": [region("reg00001", "0.1,0.625,0.4299,0.0815")] }];
  assert.equal(endpointHitsKey(none), "");
  assert.notEqual(endpointHitsKey(one), "");
  assert.notEqual(endpointHitsKey(one), endpointHitsKey(moved));
  assert.equal(endpointHitsKey(one), endpointHitsKey(structuredClone(one)));
});

test("an arrow ending on a region or pin is named by its caption, not by the macro", () => {
  // Live 2026-10-08: the endpoint chip popover read `c7 ▸ “{{[[plexus-region]]: k=…”`.
  assert.equal(endpointDisplayText("{{[[plexus-region]]: k=img d=img00001 f=0.1,0.2,0.3,0.4}} Region 2"), "Region 2");
  assert.equal(endpointDisplayText("{{[[plexus-region]]: k=img d=img00001 f=0.1,0.2,0.3,0.4}}"), "Region");
  assert.equal(endpointDisplayText("{{[[plexus-pin]]: d=pdf00001 pg=6 f=0.1,0.2,0.3,0.04}}"), "p. 6");
  assert.equal(endpointDisplayText("plain row"), "plain row");
  const text = chipText({ from: "Table", to: "c7", toBlockText: "{{[[plexus-region]]: k=img d=img00001 f=0.1,0.2,0.3,0.4}} Region 2", boardTitle: "Lab" });
  assert.equal(text, "↗ Table → c7 ▸ “Region 2” · on Lab");
});
