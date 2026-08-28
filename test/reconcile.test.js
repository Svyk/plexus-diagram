import assert from "node:assert/strict";
import test from "node:test";

import { connectedMountForUid, exitFullscreenOnNavigate, reconcileVisibleDiagrams, runtime } from "../src/feature.js";
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

test("exitFullscreenOnNavigate drops fixed overlay chrome when the house leaves the zoomed page", () => {
  const previousDocument = globalThis.document;
  const body = { classList: { remove(name) { this.removed = name; } } };
  const mount = {
    isConnected: true,
    classList: {
      tokens: new Set(["pxd-mount", "pxd-mount--zoomed", "pxd-mount--fullscreen"]),
      remove(...names) { for (const name of names) this.tokens.delete(name); },
      contains(name) { return this.tokens.has(name); },
    },
    style: { height: "100vh", minHeight: "100vh" },
  };
  const fullscreenCalls = [];
  globalThis.document = {
    body,
    querySelector(selector) {
      if (String(selector).includes('data-diagram-uid="1IIx5sG4L"')) return mount;
      return null;
    },
  };
  runtime.enhancedUids = new Set(["1IIx5sG4L"]);
  runtime.settings = { get: () => "560" };
  const session = getOrCreateSession("1IIx5sG4L", stubSession);
  session.views.add({ setFullscreen: (on) => fullscreenCalls.push(on) });
  try {
    exitFullscreenOnNavigate("#/app/Svy/page/08-27-2026");
    assert.deepEqual(fullscreenCalls, [false]);
    assert.equal(mount.classList.contains("pxd-mount--fullscreen"), false);
    assert.equal(mount.classList.contains("pxd-mount--zoomed"), false);
    assert.equal(mount.style.height, "560px");
    assert.equal(body.classList.removed, "pxd-has-fullscreen");
  } finally {
    disposeSession("1IIx5sG4L");
    globalThis.document = previousDocument;
    runtime.enhancedUids = new Set();
    runtime.settings = null;
  }
});

test("exitFullscreenOnNavigate keeps fullscreen on the zoomed diagram page itself", () => {
  const previousDocument = globalThis.document;
  const fullscreenCalls = [];
  const mount = {
    isConnected: true,
    classList: {
      tokens: new Set(["pxd-mount--fullscreen"]),
      remove() { throw new Error("must not strip fullscreen while still zoomed"); },
      contains(name) { return this.tokens.has(name); },
    },
    style: {},
  };
  globalThis.document = {
    body: { classList: { remove() { throw new Error("must not clear body while still zoomed"); } } },
    querySelector: () => mount,
  };
  runtime.enhancedUids = new Set(["1IIx5sG4L"]);
  const session = getOrCreateSession("1IIx5sG4L", stubSession);
  session.views.add({ setFullscreen: (on) => fullscreenCalls.push(on) });
  try {
    exitFullscreenOnNavigate("#/app/Svy/page/1IIx5sG4L");
    assert.deepEqual(fullscreenCalls, []);
    assert.equal(mount.classList.contains("pxd-mount--fullscreen"), true);
  } finally {
    disposeSession("1IIx5sG4L");
    globalThis.document = previousDocument;
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
