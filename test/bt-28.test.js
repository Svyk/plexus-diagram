// TSK-1. createBt reads enabled before win and re-reads it on every tool lookup.
import assert from "node:assert/strict";
import test from "node:test";

import { createBt } from "../src/host/bt.js";

test("createBt does not read win while enabled is false", async () => {
  let reads = 0;
  const options = { enabled: false };
  Object.defineProperty(options, "win", {
    enumerable: true,
    get() {
      reads += 1;
      throw new Error("win");
    },
  });
  const bt = createBt(options);
  assert.equal(bt.available(), false);
  assert.equal(bt.canCreate(), false);
  assert.equal(await bt.prime(), null);
  assert.deepEqual(await bt.modify("u1", { status: "DONE" }), { ok: false, reason: "unavailable" });
  assert.deepEqual(await bt.create({ text: "x" }), { ok: false, reason: "unavailable" });
  assert.deepEqual(await bt.search({ query: "x" }), []);
  assert.deepEqual(await bt.projects(), []);
  assert.equal(reads, 0);
});

test("createBt with a fake registry still resolves bt_modify when enabled is omitted", async () => {
  const calls = [];
  const win = {
    RoamExtensionTools: {
      "better-tasks": {
        tools: [
          { name: "bt_modify", execute: async (args) => { calls.push(args); return { uid: args.uid }; } },
        ],
      },
    },
  };
  const bt = createBt({ win });
  assert.equal(bt.available(), true);
  assert.deepEqual(await bt.modify("u1", { status: "DONE" }), { ok: true, result: { uid: "u1" } });
  assert.deepEqual(calls, [{ uid: "u1", status: "DONE" }]);
});

test("the same bridge re-reads enabled on every tool lookup", async () => {
  let on = false;
  let reads = 0;
  const win = {};
  Object.defineProperty(win, "RoamExtensionTools", {
    enumerable: true,
    get() {
      reads += 1;
      return {
        "better-tasks": {
          tools: [{ name: "bt_modify", execute: async (args) => ({ uid: args.uid }) }, { name: "bt_get_attributes", execute: async () => ({ attributes: [] }) }],
        },
      };
    },
  });
  const bt = createBt({ win, enabled: () => on });
  assert.equal(bt.available(), false);
  assert.equal(await bt.prime(), null);
  assert.deepEqual(await bt.modify("u1", { status: "DONE" }), { ok: false, reason: "unavailable" });
  assert.equal(reads, 0);
  on = true;
  assert.equal(bt.available(), true);
  assert.ok(reads > 0);
  const seen = reads;
  on = false;
  assert.equal(bt.available(), false);
  assert.equal(await bt.prime(), null);
  assert.deepEqual(await bt.modify("u1", { status: "DONE" }), { ok: false, reason: "unavailable" });
  assert.equal(reads, seen);
});
