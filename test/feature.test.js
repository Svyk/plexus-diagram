import assert from "node:assert/strict";
import test from "node:test";

import { openNestedDiagram, runtime, nestStack, syncNestStackOnNavigate } from "../src/feature.js";

function roamStub(order) {
  return {
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
            "markEnhanced must register the uid before openBlock",
          );
        },
      },
    },
  };
}

test("openNestedDiagram calls markEnhanced before openBlock", async () => {
  const previousRoam = globalThis.roamAlphaAPI;
  const previousDocument = globalThis.document;
  const previousUids = runtime.enhancedUids;
  const previousMetadata = runtime.metadata;
  const order = [];
  globalThis.document = undefined;
  globalThis.roamAlphaAPI = roamStub(order);
  runtime.metadata = null;
  runtime.enhancedUids = new Set();
  runtime.activeDiagramUid = null;
  nestStack.length = 0;
  try {
    await openNestedDiagram("nested-uid");
    assert.deepEqual(order, ["openBlock"]);
    assert.ok(runtime.enhancedUids.has("nested-uid"));
    assert.equal(nestStack.length, 0);
  } finally {
    nestStack.length = 0;
    runtime.activeDiagramUid = null;
    runtime.metadata = previousMetadata;
    runtime.enhancedUids = previousUids;
    globalThis.roamAlphaAPI = previousRoam;
    globalThis.document = previousDocument;
  }
});

test("openNestedDiagram ignores parent .rm-diagram and does not wait", async () => {
  const start = Date.now();
  const previousRoam = globalThis.roamAlphaAPI;
  const previousDocument = globalThis.document;
  const previousUids = runtime.enhancedUids;
  const previousMetadata = runtime.metadata;
  const order = [];
  const parentClasses = new Set(["rm-diagram"]);
  const parentDiagram = {
    classList: {
      contains: (name) => parentClasses.has(name),
      add: (name) => parentClasses.add(name),
      remove: () => {},
    },
    nextElementSibling: null,
    isConnected: true,
  };
  globalThis.document = {
    querySelector: (sel) => (sel === ".rm-diagram" ? parentDiagram : null),
    getElementById: () => null,
    createElement: () => ({ id: "", textContent: "", isConnected: false }),
    head: { appendChild: () => {} },
  };
  globalThis.roamAlphaAPI = roamStub(order);
  runtime.metadata = null;
  runtime.enhancedUids = new Set();
  runtime.activeDiagramUid = null;
  nestStack.length = 0;
  try {
    await openNestedDiagram("nested-uid");
    assert.ok(Date.now() - start < 500, "must finish well under 500ms without parent wait");
    assert.deepEqual(order, ["openBlock"]);
    assert.ok(runtime.enhancedUids.has("nested-uid"));
    assert.ok(!parentClasses.has("pxd-native-hidden"), "parent canvas must not be enhanced");
    assert.equal(parentDiagram.nextElementSibling, null, "parent canvas must not receive a mount");
    assert.equal(nestStack.length, 0);
  } finally {
    nestStack.length = 0;
    runtime.activeDiagramUid = null;
    runtime.metadata = previousMetadata;
    runtime.enhancedUids = previousUids;
    globalThis.roamAlphaAPI = previousRoam;
    globalThis.document = previousDocument;
  }
});

test("openNestedDiagram pushes the parent uid+title onto the nest stack", async () => {
  const previousRoam = globalThis.roamAlphaAPI;
  const previousDocument = globalThis.document;
  const previousUids = runtime.enhancedUids;
  const previousMetadata = runtime.metadata;
  const order = [];
  globalThis.document = undefined;
  const api = roamStub(order);
  const innerPull = api.data.pull;
  api.data.pull = (_pattern, ref) => {
    const uid = Array.isArray(ref) ? ref[1] : ref;
    if (uid === "parent-uid") return { ":block/string": "{{[[diagram]]:Alpha}}" };
    return innerPull(_pattern, ref);
  };
  globalThis.roamAlphaAPI = api;
  runtime.metadata = null;
  runtime.enhancedUids = new Set();
  nestStack.length = 0;
  try {
    await openNestedDiagram("nested-uid", "parent-uid");
    assert.equal(nestStack.length, 1);
    assert.equal(nestStack[0].uid, "parent-uid");
    assert.equal(nestStack[0].title, "Alpha");
    syncNestStackOnNavigate("#/app/graph/page/parent-uid");
    assert.equal(nestStack.length, 0);
  } finally {
    nestStack.length = 0;
    runtime.metadata = previousMetadata;
    runtime.enhancedUids = previousUids;
    globalThis.roamAlphaAPI = previousRoam;
    globalThis.document = previousDocument;
  }
});

test("syncNestStackOnNavigate truncates deeper entries when jumping back multiple levels", () => {
  nestStack.length = 0;
  nestStack.push({ uid: "a", title: "A" }, { uid: "b", title: "B" });
  syncNestStackOnNavigate("#/app/graph/page/a");
  assert.equal(nestStack.length, 0);
  nestStack.push({ uid: "a", title: "A" }, { uid: "b", title: "B" });
  syncNestStackOnNavigate("#/app/graph/page/b");
  assert.equal(nestStack.length, 1);
  assert.equal(nestStack[0].uid, "a");
});
