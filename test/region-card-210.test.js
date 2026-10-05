// ECO-3: region-ref when the target is a Roam Plexus region and the API is new enough.
import assert from "node:assert/strict";
import test from "node:test";

import { regionRefKind, regionRefModel } from "../src/model/region-card.js";
import { parseRegion } from "../src/model/regions.js";

const api6 = { apiVersion: 6 };
const api7 = { apiVersion: 7 };
const api5 = { apiVersion: 5 };

const AREA = "{{[[plexus-region]]: k=area d=ITvT3bqaL ids=pmm-3NChDbxPu-h6dynpr9M pad=10}} ((h6dynpr9M))";
const RECT = "{{[[plexus-region]]: k=rect d=ITvT3bqaL el=plx-img-a f=0.25,0.25,0.5,0.5}} Image crop";
const FRAME = "{{[[plexus-region]]: k=frame d=ITvT3bqaL fr=plx-frame-a pad=10}}";
const IMG = "{{[[plexus-region]]: k=img d=imgcard01 f=0.1,0.2,0.3,0.4}} hamstring";
const VIEW = "{{[[plexus-region]]: k=view d=board0001 v=0,0,10,10}} saved";
const BAD = "{{[[plexus-region]]: k=area d=ITvT3bqaL}}";

test("supported false is region-ref for area, rect, and frame", () => {
  const samples = [
    [AREA, "area", "((h6dynpr9M))", api6],
    [RECT, "rect", "Image crop", api7],
    [FRAME, "frame", "", api6],
  ];
  for (const [sample, regionKind, caption, api] of samples) {
    const region = parseRegion(sample);
    assert.equal(region.owner, "roam-plexus");
    assert.equal(region.supported, false);
    assert.equal(region.error, undefined);
    assert.equal(regionRefKind(sample, api), "region-ref");
    assert.deepEqual(regionRefModel(sample, api), {
      kind: "region-ref",
      caption,
      drawingUid: "ITvT3bqaL",
      regionKind,
    });
  }
});

test("img, view, a missing api, apiVersion 5, and an error are null", () => {
  assert.equal(parseRegion(IMG).owner, "plexus-diagram");
  assert.equal(parseRegion(VIEW).owner, "plexus-diagram");
  assert.equal(parseRegion(BAD).error, "missing ids");
  for (const sample of [IMG, VIEW, BAD, "((eyjMKi1DA))", "not a region"]) {
    assert.equal(regionRefKind(sample, api7), null);
    assert.equal(regionRefModel(sample, api6), null);
  }
  assert.equal(regionRefKind(AREA, null), null);
  assert.equal(regionRefKind(AREA, undefined), null);
  assert.equal(regionRefModel(AREA, null), null);
  assert.equal(regionRefKind(AREA, api5), null);
  assert.equal(regionRefModel(RECT, api5), null);
  assert.equal(regionRefKind(FRAME, {}), null);
});
