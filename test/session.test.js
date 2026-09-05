import assert from "node:assert/strict";
import test from "node:test";

import { MetadataStore } from "../src/metadata.js";
import { NativeDiagramSession } from "../src/session.js";

function installDeleteRoamMock() {
  const diagramChildren = [
    { uid: "card-a", string: "Hello card", order: 0, children: [] },
    { uid: "card-b", string: "Other", order: 1, children: [] },
  ];
  const toPull = (children) => ({
    ":block/uid": "diagram-1",
    ":block/string": "{{[[diagram]]}}",
    ":block/children": children.map((child) => ({
      ":block/uid": child.uid,
      ":block/string": child.string,
      ":block/order": child.order,
      ":block/children": [],
    })),
  });
  let pullCount = 0;
  globalThis.roamAlphaAPI = {
    util: { generateUID: () => "generated-uid" },
    data: {
      q: (query) => (String(query).includes("plexus-diagram/metadata") ? [["meta-page"]] : []),
      pull: (_pattern, ref) => {
        const uid = Array.isArray(ref) ? ref[1] : ref;
        if (uid === "meta-page") {
          return {
            ":block/uid": "meta-page",
            ":block/string": "",
            ":block/children": [
              { ":block/uid": "schema", ":block/string": "schema-version:: 1", ":block/children": [] },
              {
                ":block/uid": "enhanced",
                ":block/string": "enhanced::",
                ":block/children": [{
                  ":block/uid": "diagram-block",
                  ":block/string": "diagram-1",
                  ":block/children": [],
                }],
              },
            ],
          };
        }
        if (uid === "diagram-1") {
          pullCount += 1;
          return toPull(diagramChildren);
        }
        return null;
      },
      page: { create: async () => {} },
      block: {
        create: async () => {},
        update: async () => {},
        delete: async ({ block }) => {
          const idx = diagramChildren.findIndex((child) => child.uid === block.uid);
          if (idx >= 0) diagramChildren.splice(idx, 1);
        },
      },
      addPullWatch: () => {},
      removePullWatch: () => {},
    },
    updateBlock: async () => {},
  };
  return { getPullCount: () => pullCount };
}

function sampleLayout() {
  const nodes = new Map([
    ["card-a", { pos: { x: 0, y: 0 }, size: { width: 280, height: 160 }, color: "" }],
    ["card-b", { pos: { x: 400, y: 0 }, size: { width: 280, height: 160 }, color: "" }],
  ]);
  return {
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes,
    edges: [],
    sections: new Map(),
  };
}

test("deleteCards resolves without nested persistQueue deadlock", async () => {
  installDeleteRoamMock();
  const store = new MetadataStore();
  store.pageUid = "meta-page";
  store.reload();
  const layout = sampleLayout();
  store.diagrams.set("diagram-1", layout);
  store.diagramBlockUids.set("diagram-1", "diagram-block");

  let setCalls = 0;
  const originalSet = store.set.bind(store);
  store.set = async (...args) => {
    setCalls += 1;
    return originalSet(...args);
  };

  const session = new NativeDiagramSession({
    diagramUid: "diagram-1",
    metadataStore: store,
    settings: { get: (key) => (key === "default-card-width" ? 280 : key === "default-card-height" ? 160 : undefined) },
  });
  session.load();

  const raced = await Promise.race([
    session.deleteCards(["card-a"]),
    new Promise((_, reject) => setTimeout(() => reject(new Error("deleteCards hung")), 200)),
  ]);

  assert.equal(raced, undefined);
  assert.equal(session.model.getCard("card-a"), null);
  assert.equal(setCalls, 1);
});
