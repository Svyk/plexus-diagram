import assert from "node:assert/strict";
import test from "node:test";

import { openNestedDiagram, runtime } from "../src/feature.js";

test("openNestedDiagram calls enhance before openBlock", async () => {
  const previousRoam = globalThis.roamAlphaAPI;
  const previousDocument = globalThis.document;
  const previousUids = runtime.enhancedUids;
  const previousMetadata = runtime.metadata;
  const order = [];
  globalThis.document = undefined;
  globalThis.roamAlphaAPI = {
    util: { generateUID: () => "gen-1" },
    data: {
      q: (query) => (String(query).includes("plexus-diagram/metadata") ? [["meta-page"]] : []),
      pull: (_pattern, ref) => {
        const uid = Array.isArray(ref) ? ref[1] : ref;
        if (uid === "meta-page") {
          return {
            uid: "meta-page",
            string: "",
            children: [
              { uid: "schema", string: "schema-version:: 1", children: [] },
              { uid: "enhanced", string: "enhanced::", children: [] },
            ],
          };
        }
        return { uid, string: "", children: [] };
      },
      page: { create: async () => {} },
      block: {
        create: async () => {},
        update: async () => {},
        delete: async () => {},
      },
    },
    ui: {
      mainWindow: {
        openBlock: async ({ block }) => {
          order.push("openBlock");
          assert.ok(
            runtime.enhancedUids.has(block.uid),
            "enhanceByUid must register the uid before openBlock",
          );
        },
      },
    },
  };
  runtime.metadata = null;
  runtime.enhancedUids = new Set();
  try {
    await openNestedDiagram("nested-uid");
    assert.deepEqual(order, ["openBlock"]);
    assert.ok(runtime.enhancedUids.has("nested-uid"));
  } finally {
    runtime.metadata = previousMetadata;
    runtime.enhancedUids = previousUids;
    globalThis.roamAlphaAPI = previousRoam;
    globalThis.document = previousDocument;
  }
});
