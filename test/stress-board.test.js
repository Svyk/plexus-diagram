import assert from "node:assert/strict";
import test from "node:test";

import { TEMPLATE_WRITE_CAP } from "../src/model/templates.js";
import {
  STRESS_CARDS,
  STRESS_EDGES,
  STRESS_SECTIONS,
  STRESS_TITLE,
  planStressBoard,
} from "../src/model/stress-board.js";
import { boardString } from "../src/model/schema.js";

let seq = 0;
const genUid = () => `u${seq += 1}`;

test("PF-2: the stress board is 300 cards, 20 sections, 150 edges, in chunks of 45", () => {
  seq = 0;
  const plan = planStressBoard({ genUid, parentUid: "pageLAB" });
  const ofType = (type) => plan.creates.filter((op) => op.props?.plexus?.type === type);
  assert.equal(plan.creates[0].string, boardString(STRESS_TITLE));
  assert.equal(plan.creates[0].parent, "pageLAB");
  assert.equal(plan.creates[0].open, false);
  assert.equal(ofType("section").length, STRESS_SECTIONS);
  assert.equal(ofType("card").length, STRESS_CARDS);
  assert.equal(ofType("edge").length, STRESS_EDGES);
  assert.equal(plan.creates.filter((op) => op.props?.plexus?.type === "edges").length, 1);
  assert.equal(plan.creates.length, 1 + STRESS_SECTIONS + STRESS_CARDS + 1 + STRESS_EDGES);
  assert.ok(plan.chunks.length > 1);
  assert.ok(plan.chunks.every((chunk) => chunk.length > 0 && chunk.length <= TEMPLATE_WRITE_CAP));
  assert.equal(plan.chunks.flat().length, plan.creates.length);

  const seen = new Set(["pageLAB"]);
  const cards = new Set();
  for (const op of plan.creates) {
    assert.ok(seen.has(op.parent), `parent missing for ${op.string}`);
    seen.add(op.uid);
    const px = op.props?.plexus;
    if (px?.type === "card") cards.add(op.uid);
    if (px?.type === "section" || px?.type === "card") {
      assert.equal(typeof px.x, "number");
      assert.equal(typeof px.y, "number");
      assert.equal(px.v, 2);
    }
  }
  const perSection = new Map();
  for (const op of ofType("card")) perSection.set(op.parent, (perSection.get(op.parent) || 0) + 1);
  assert.equal(perSection.size, STRESS_SECTIONS);
  for (const count of perSection.values()) assert.equal(count, STRESS_CARDS / STRESS_SECTIONS);
  for (const op of ofType("edge")) {
    assert.ok(cards.has(op.props.plexus.from));
    assert.ok(cards.has(op.props.plexus.to));
    assert.match(op.string, new RegExp(`\\(\\(${op.props.plexus.from}\\)\\).*\\(\\(${op.props.plexus.to}\\)\\)`));
  }
});
