// Wire for ECO-2 and ECO-3. Imports the shipped helpers. Does not reimplement them.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildBoard } from "../src/model/board.js";
import { regionRefModel } from "../src/model/region-card.js";
import { addPublicCard } from "../src/session.js";

const AREA = "{{[[plexus-region]]: k=area d=ITvT3bqaL ids=pmm-3NChDbxPu-h6dynpr9M pad=10}} ((h6dynpr9M))";
const IMG = "{{[[plexus-region]]: k=img d=imgcard01 f=0.1,0.2,0.3,0.4}} hamstring";
const api = { apiVersion: 7 };

test("addPublicCard creates one child of the board and defaults x and y to 40", () => {
  const calls = [];
  const made = addPublicCard({ boardUid: "boardA", string: "((eyjMKi1DA))" }, (op) => {
    calls.push(op);
    return "new1";
  });
  assert.equal(made, "new1");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { parent: "boardA", string: "((eyjMKi1DA))", x: 40, y: 40 });

  const placed = [];
  const op = addPublicCard({
    boardUid: "boardA",
    string: "[[Page]]",
    x: 0,
    y: 5,
    create(row) {
      placed.push(row);
      return row;
    },
  });
  assert.equal(placed.length, 1);
  assert.equal(op, placed[0]);
  assert.equal(placed[0].parent, "boardA");
  assert.equal(placed[0].x, 0);
  assert.equal(placed[0].y, 5);
  assert.equal(Object.hasOwn(placed[0], "container"), false);
});

test("buildBoard keeps a block card whose target is a Roam Plexus region", () => {
  const calls = [];
  const board = buildBoard({
    ":block/uid": "boardA",
    ":block/string": "{{[[diagram]]:Lab}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": [
      {
        ":block/uid": "card1",
        ":block/string": "((eyjMKi1DA))",
        ":block/order": 0,
        ":block/props": { ":plexus": { ":x": 10, ":y": 20 } },
        ":block/children": [],
      },
      {
        ":block/uid": "imgref",
        ":block/string": "((imgref001))",
        ":block/order": 1,
        ":block/props": { ":plexus": { ":x": 30, ":y": 40 } },
        ":block/children": [],
      },
      {
        ":block/uid": "own",
        ":block/string": AREA,
        ":block/order": 2,
        ":block/children": [],
      },
    ],
  }, {
    defaults: { card: { w: 300, h: 200 } },
    resolve(uid) {
      calls.push(uid);
      return uid === "eyjMKi1DA" ? AREA : IMG;
    },
    plexusApi: api,
  });
  const model = regionRefModel(AREA, api);
  assert.ok(model);
  assert.deepEqual(calls, ["eyjMKi1DA", "imgref001"]);
  assert.equal(board.items.has("own"), false);
  const card = board.items.get("card1");
  assert.equal(board.items.has("card1"), true);
  assert.equal(card.kind, "region-ref");
  assert.equal(card.title, model.caption);
  assert.equal(card.regionDrawing, model.drawingUid);
  assert.deepEqual(card.target, { kind: "block", uid: "eyjMKi1DA" });
  assert.deepEqual([card.w, card.h], [300, 200]);
  const img = board.items.get("imgref");
  assert.equal(board.items.has("imgref"), true);
  assert.equal(img.kind, "block");
  assert.equal(regionRefModel(IMG, api), null);
});

test("feature.js keeps exactly two commandPalette labels", () => {
  const src = readFileSync(new URL("../src/feature.js", import.meta.url), "utf8");
  const labels = [...src.matchAll(/commandPalette,\s*\{[\s\S]*?label:\s*"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(labels, ["Plexus: Commands…", "Plexus: New whiteboard here"]);
  assert.equal((src.match(/commandPalette/g) || []).length, 2);
  assert.equal(src.includes("rasterizeSvg"), false);
  assert.equal(src.includes("setPointerCapture"), false);
  assert.equal(regionRefModel(AREA, api)?.kind, "region-ref");
});
