import assert from "node:assert/strict";
import test from "node:test";

import { connectedMountForUid, reconcileVisibleDiagrams, runtime } from "../src/feature.js";
import { disposeSession, getOrCreateSession, getSession, pruneDetachedViews } from "../src/session.js";

function stubSession() {
  return {
    views: new Set(),
    removeView(view) {
      this.views.delete(view);
    },
    dispose() {},
  };
}

test("pruneDetachedViews disposes detached views and keeps connected ones", () => {
  const disposed = [];
  const session = getOrCreateSession("prune-test-uid", stubSession);
  const dead = {
    wrapper: { isConnected: false },
    canvas: { root: { isConnected: false } },
    dispose: () => disposed.push("dead"),
  };
  const live = {
    wrapper: { isConnected: true },
    canvas: { root: { isConnected: true } },
    dispose: () => disposed.push("live"),
  };
  session.views.add(dead);
  session.views.add(live);
  try {
    pruneDetachedViews(session);
    assert.deepEqual(disposed, ["dead"]);
    assert.equal(session.views.has(dead), false);
    assert.equal(session.views.has(live), true);
  } finally {
    disposeSession("prune-test-uid");
  }
});

test("getOrCreateSession prunes detached views of an existing session", () => {
  const disposed = [];
  const session = getOrCreateSession("prune-on-get-uid", stubSession);
  session.views.add({
    wrapper: { isConnected: false },
    canvas: { root: { isConnected: false } },
    dispose: () => disposed.push("dead"),
  });
  try {
    const again = getOrCreateSession("prune-on-get-uid", stubSession);
    assert.equal(again, session);
    assert.deepEqual(disposed, ["dead"]);
    assert.equal(again.views.size, 0);
  } finally {
    disposeSession("prune-on-get-uid");
  }
});

test("reconcileVisibleDiagrams does not remount when a connected mount exists", async () => {
  const previousDocument = globalThis.document;
  const previousLocation = globalThis.location;
  globalThis.location = { hash: "#/app/Svy/page/zoomuid" };
  globalThis.document = {
    querySelector(selector) {
      if (selector.includes('.pxd-mount[data-diagram-uid="zoomuid"]')) return { isConnected: true };
      return null;
    },
  };
  runtime.enhancedUids = new Set(["zoomuid"]);
  try {
    await reconcileVisibleDiagrams();
    assert.equal(getSession("zoomuid"), null);
  } finally {
    globalThis.document = previousDocument;
    globalThis.location = previousLocation;
    runtime.enhancedUids = new Set();
  }
});

test("reconcileVisibleDiagrams skips enhanced uids whose native canvas is not in view", async () => {
  const previousDocument = globalThis.document;
  const previousLocation = globalThis.location;
  globalThis.location = { hash: "#/app/Svy/page/otherpage" };
  globalThis.document = { querySelector: () => null };
  runtime.enhancedUids = new Set(["missinguid"]);
  try {
    await reconcileVisibleDiagrams();
    assert.equal(getSession("missinguid"), null);
  } finally {
    globalThis.document = previousDocument;
    globalThis.location = previousLocation;
    runtime.enhancedUids = new Set();
  }
});

test("connectedMountForUid ignores detached mounts", () => {
  const detached = { isConnected: false };
  const root = { querySelector: () => detached };
  assert.equal(connectedMountForUid("someuid", root), null);
  const connected = { isConnected: true };
  assert.equal(connectedMountForUid("someuid", { querySelector: () => connected }), connected);
});
