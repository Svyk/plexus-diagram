import assert from "node:assert/strict";
import test from "node:test";

import { DiagramAdapter } from "../src/adapter.js";

test("createChild uses util.generateUID and defaults order to last", async () => {
  const created = [];
  let pullCount = 0;
  globalThis.roamAlphaAPI = {
    util: { generateUID: () => "generated-uid-1" },
    data: {
      pull: () => {
        pullCount += 1;
        if (pullCount === 1) {
          return { ":block/uid": "diagram-1", ":block/children": [] };
        }
        return {
          ":block/uid": "diagram-1",
          ":block/children": [{
            ":block/uid": "generated-uid-1",
            ":block/string": "hello",
            ":block/order": 0,
          }],
        };
      },
      block: {
        create: async (opts) => { created.push(opts); },
      },
      addPullWatch: () => {},
      removePullWatch: () => {},
    },
  };

  const adapter = new DiagramAdapter("diagram-1", "[:block/uid :block/children [:block/uid :block/string :block/order]]");
  const uid = await adapter.createChild("hello");

  assert.equal(uid, "generated-uid-1");
  assert.equal(created.length, 1);
  assert.equal(created[0].block.uid, "generated-uid-1");
  assert.equal(created[0].location.order, "last");
});
