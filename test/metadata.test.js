import assert from "node:assert/strict";
import test from "node:test";

import { createBlock, createPage, parseMetadataTree, serializeDiagramMetadata, acquireScratch, blankScratch, releaseScratch, SCRATCH_MARKER } from "../src/metadata.js";

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

test("parse/serialize round-trip of edge from/to/direction/color", () => {
  const tree = {
    uid: "page",
    string: "",
    children: [
      { uid: "schema", string: "schema-version:: 1", children: [] },
      {
        uid: "enhanced",
        string: "enhanced::",
        children: [{
          uid: "d1",
          string: "diagram-1",
          children: [
            {
              uid: "e1",
              string: "edge a->b",
              children: [
                { uid: "from", string: "from:: right", children: [] },
                { uid: "to", string: "to:: left", children: [] },
                { uid: "dir", string: "direction:: twoWay", children: [] },
                { uid: "col", string: "color:: teal", children: [] },
              ],
            },
          ],
        }],
      },
    ],
  };
  const parsed = parseMetadataTree(tree);
  const edge = parsed.diagrams.get("diagram-1").edges[0];
  assert.equal(edge.source, "a");
  assert.equal(edge.target, "b");
  assert.equal(edge.from, "right");
  assert.equal(edge.to, "left");
  assert.equal(edge.direction, "twoWay");
  assert.equal(edge.color, "teal");
  const serialized = serializeDiagramMetadata("diagram-1", parsed.diagrams.get("diagram-1"));
  assert.match(serialized, /from:: right/);
  assert.match(serialized, /to:: left/);
  assert.match(serialized, /direction:: twoWay/);
  assert.match(serialized, /color:: teal/);
  const defaultsLayout = {
    viewport: null,
    nodes: new Map(),
    edges: [{ source: "a", target: "b", kind: "bezier", label: "", from: "auto", to: "auto", direction: "", color: "" }],
    sections: new Map(),
  };
  const defaultsSerialized = serializeDiagramMetadata("diagram-1", defaultsLayout);
  assert.doesNotMatch(defaultsSerialized, /from::/);
  assert.doesNotMatch(defaultsSerialized, /to::/);
  assert.doesNotMatch(defaultsSerialized, /direction::/);
  assert.doesNotMatch(defaultsSerialized, /color::/);
});

test("parse/serialize round-trip of node and section color::", () => {
  const tree = {
    uid: "page",
    string: "",
    children: [
      { uid: "schema", string: "schema-version:: 1", children: [] },
      {
        uid: "enhanced",
        string: "enhanced::",
        children: [{
          uid: "d1",
          string: "diagram-1",
          children: [
            {
              uid: "n1",
              string: "node card-a",
              children: [
                { uid: "pos", string: "pos:: 10,20", children: [] },
                { uid: "size", string: "size:: 280,160", children: [] },
                { uid: "col", string: "color:: teal", children: [] },
              ],
            },
            {
              uid: "s1",
              string: "section s1",
              children: [
                { uid: "spos", string: "pos:: 0,0", children: [] },
                { uid: "ssize", string: "size:: 320,240", children: [] },
                { uid: "stitle", string: "title:: Frame", children: [] },
                { uid: "scol", string: "color:: rose", children: [] },
              ],
            },
          ],
        }],
      },
    ],
  };
  const parsed = parseMetadataTree(tree);
  const layout = parsed.diagrams.get("diagram-1");
  assert.equal(layout.nodes.get("card-a").color, "teal");
  assert.equal(layout.sections.get("s1").color, "rose");
  const serialized = serializeDiagramMetadata("diagram-1", layout);
  assert.match(serialized, /node card-a/);
  assert.match(serialized, /color:: teal/);
  assert.match(serialized, /section s1/);
  assert.match(serialized, /color:: rose/);
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
  assert.equal(roundTrip.diagrams.get("diagram-1").nodes.get("card-a").color, "teal");
  assert.equal(roundTrip.diagrams.get("diagram-1").sections.get("s1").color, "rose");
});

test("blankScratch deletes leftover scratch children", async () => {
  const deleted = [];
  const blocks = {
    uid: "page",
    string: "",
    children: [{
      uid: "marker",
      string: SCRATCH_MARKER,
      children: [{
        uid: "host",
        string: "test",
        children: [
          { uid: "kid-1", string: "test", children: [] },
          { uid: "kid-2", string: "{{[[diagram]]}}", children: [] },
        ],
      }],
    }],
  };
  const walk = (n, uid) => (n.uid === uid ? n : (n.children || []).map((c) => walk(c, uid)).find(Boolean));
  const toPull = (node) => node && ({
    uid: node.uid,
    string: node.string,
    order: 0,
    children: (node.children || []).map(toPull),
  });
  globalThis.roamAlphaAPI = {
    util: { generateUID: () => "new" },
    q: () => [["page"]],
    data: {
      q: () => [["page"]],
      pull: (_p, entity) => toPull(walk(blocks, Array.isArray(entity) ? entity[1] : entity)),
      block: {
        update: async ({ block }) => {
          const node = walk(blocks, block.uid);
          if (node) node.string = block.string;
        },
        delete: async ({ block }) => { deleted.push(block.uid); },
        create: async () => {},
      },
    },
  };
  await releaseScratch();
  const scratch = await acquireScratch();
  assert.equal(scratch?.uid, "host");
  await blankScratch();
  assert.ok(deleted.includes("kid-1"), `expected kid-1 deleted, got ${JSON.stringify(deleted)}`);
  assert.ok(deleted.includes("kid-2"), `expected kid-2 deleted, got ${JSON.stringify(deleted)}`);
  await releaseScratch();
});

