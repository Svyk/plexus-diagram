import assert from "node:assert/strict";
import test from "node:test";

import { NEIGHBOR_CAP, neighborLayout, pageRefString, splitNeighbors } from "../src/model/neighbors.js";

test("splitNeighbors keeps refs, backlinks, and attribute values apart", () => {
  const split = splitNeighbors({
    selfTitle: "Alpha",
    selfUid: "selfblock",
    outgoing: [
      ["Alpha", "self [[Alpha]]"],
      ["Causes", "Causes:: [[Beta]]"],
      ["Beta", "Causes:: [[Beta]]"],
      ["Gamma", "see [[Gamma]]"],
      ["Gamma", "see [[Gamma]] again"],
      ["Delta", "plain"],
    ],
    incoming: [
      ["selfblock", "me", "Notes"],
      ["b1", "back", "Notes"],
      ["b2", "back", "Notes"],
      ["b3", "other", "Zed"],
      ["b4", "Role:: [[Alpha]]", "Delta"],
      ["b5", "same page", "Alpha"],
    ],
  });
  assert.deepEqual(split.out, ["Gamma", "Delta"]);
  assert.deepEqual(split.attr, ["Beta"]);
  assert.deepEqual(split.in, ["Notes", "Zed"]);
  assert.equal(NEIGHBOR_CAP, 24);
});

test("splitNeighbors caps each list at 24", () => {
  const outgoing = [];
  for (let i = 0; i < 30; i++) outgoing.push([`Page ${String(i).padStart(2, "0")}`, "see"]);
  const split = splitNeighbors({ outgoing });
  assert.equal(split.out.length, 24);
  assert.equal(split.out[0], "Page 00");
  assert.equal(split.out[23], "Page 23");
  assert.deepEqual(split.in, []);
  assert.deepEqual(split.attr, []);
});

test("neighborLayout rings page cards and writes no edges", () => {
  assert.equal(pageRefString("Ok"), "[[Ok]]");
  assert.equal(pageRefString(" bad]] "), null);
  assert.equal(pageRefString("a\nb"), null);
  const one = neighborLayout({ x: 100, y: 200, w: 280, h: 160 }, ["Only"]);
  assert.equal(one.length, 1);
  assert.equal(one[0].string, "[[Only]]");
  assert.equal(Object.hasOwn(one[0], "from"), false);
  assert.ok(one[0].y < 200, "a single neighbour sits above the source");
  const ring = neighborLayout(
    { x: 0, y: 0, w: 200, h: 100 },
    ["A", "B", "A", "bad]]", "Skip", "C"],
    { skip: ["Skip"] },
  );
  assert.deepEqual(ring.map((card) => card.string), ["[[A]]", "[[B]]", "[[C]]"]);
  assert.ok(ring[0].y < ring[1].y, "the first card is the top of the ring");
  assert.deepEqual(neighborLayout(null, ["A"]), []);
  const many = [];
  for (let i = 0; i < 30; i++) many.push(`N${i}`);
  assert.equal(neighborLayout({ x: 0, y: 0, w: 10, h: 10 }, many).length, 24);
});
