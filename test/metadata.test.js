import assert from "node:assert/strict";
import test from "node:test";

import { createBlock, createPage } from "../src/metadata.js";

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
