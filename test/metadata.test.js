import assert from "node:assert/strict";
import test from "node:test";

import { createBlock, createPage, parseMetadataTree, serializeDiagramMetadata } from "../src/metadata.js";

function installRoamMock() {
  const created = { pages: [], blocks: [] };
  let n = 0;
  globalThis.roamAlphaAPI = {
    util: { generateUID: () => `uid-${++n}` },
    data: {
      q: () => [],
      page: {
        create: async (opts) => { created.pages.push(opts); },
      },
      block: {
        create: async (opts) => { created.blocks.push(opts); },
      },
    },
  };
  return created;
}

test("createBlock generates a uid and does not use the create return value", async () => {
  const created = installRoamMock();
  const uid = await createBlock("parent-1", "schema-version:: 1");
  assert.equal(uid, "uid-1");
  assert.equal(created.blocks[0].block.uid, "uid-1");
  assert.equal(created.blocks[0].location["parent-uid"], "parent-1");
  assert.equal(created.blocks[0].location.order, "last");
});

test("createPage uses data.page.create with a generated uid", async () => {
  const created = installRoamMock();
  const uid = await createPage("plexus-diagram/metadata");
  assert.equal(uid, "uid-1");
  assert.equal(created.pages[0].page.title, "plexus-diagram/metadata");
  assert.equal(created.pages[0].page.uid, "uid-1");
  assert.equal(created.blocks.length, 0);
});

test("parse/serialize round-trip of edge label::", () => {
  const tree = {
    uid: "page",
    string: "",
    children: [
      { uid: "schema", string: "schema-version:: 1", children: [] },
      { uid: "scratch", string: "pxd:scratch", children: [{ uid: "host", string: " ", children: [] }] },
      {
        uid: "enhanced",
        string: "enhanced::",
        children: [{
          uid: "d1",
          string: "diagram-1",
          children: [
            { uid: "vp", string: "viewport:: 0,0,1", children: [] },
            {
              uid: "e1",
              string: "edge card-a->card-b",
              children: [
                { uid: "kind", string: "kind:: straight", children: [] },
                { uid: "lab", string: "label:: because it follows", children: [] },
              ],
            },
          ],
        }],
      },
    ],
  };
  const parsed = parseMetadataTree(tree);
  const edge = parsed.diagrams.get("diagram-1").edges[0];
  assert.equal(edge.source, "card-a");
  assert.equal(edge.target, "card-b");
  assert.equal(edge.kind, "straight");
  assert.equal(edge.label, "because it follows");
  const serialized = serializeDiagramMetadata("diagram-1", parsed.diagrams.get("diagram-1"));
  assert.match(serialized, /edge card-a->card-b/);
  assert.match(serialized, /label:: because it follows/);
  const roundTrip = parseMetadataTree({
    uid: "page",
    children: [
      { uid: "enhanced", string: "enhanced::", children: [{
        uid: "d1",
        string: "diagram-1",
        children: serialized.split("\n").slice(1).reduce((acc, line) => {
          const indent = (line.match(/^ */)?.[0].length || 0) / 2;
          const content = line.trim();
          if (!content) return acc;
          const node = { uid: content, string: content, children: [] };
          if (indent === 1) acc.push(node);
          else acc[acc.length - 1]?.children.push(node);
          return acc;
        }, []),
      }] },
    ],
  });
  assert.equal(roundTrip.diagrams.get("diagram-1").edges[0].label, "because it follows");
});
