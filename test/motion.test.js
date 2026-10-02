import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { cardDeepLink } from "../src/model/deeplink.js";
import { createSettingsPanel, normalizeSetting } from "../src/settings.js";
import { mountBoardView } from "../src/view/board-view.js";
import { MOTION_PROFILE, resolveMotion } from "../src/view/motion.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const pull = (children) => ({
  ":block/uid": "board0001",
  ":block/string": "{{[[diagram]]:Motion}}",
  ":block/props": { ":plexus": { ":v": 2 } },
  ":block/children": children,
});

const card = {
  ":block/uid": "cardAAAA1",
  ":block/string": "Alpha",
  ":block/order": 0,
  ":block/props": { ":plexus": { ":x": 0, ":y": 0, ":w": 200, ":h": 100 } },
  ":block/children": [],
};

function sessionFor(board) {
  const handlers = new Map();
  return {
    uid: board.uid,
    board,
    rects: worldRects(board),
    links: [],
    coveredEdges: new Set(),
    on(name, fn) {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name).add(fn);
      return () => handlers.get(name).delete(fn);
    },
    emit(name, payload) { for (const fn of [...(handlers.get(name) || [])]) fn(payload); },
    release() {},
  };
}

function mount(motion, { reduced = false, onChange } = {}) {
  const stub = createDomStub();
  const restore = stub.install();
  if (reduced || onChange) {
    stub.window.matchMedia = (query) => {
      const reduce = String(query).includes("prefers-reduced-motion");
      const mq = {
        get matches() { return reduce ? reduced : false; },
        media: String(query),
        addEventListener(type, fn) { if (reduce && type === "change" && onChange) onChange.set(fn); },
        removeEventListener() {},
      };
      return mq;
    };
  }
  const board = buildBoard(pull([card]));
  const session = sessionFor(board);
  const mountEl = stub.document.createElement("div");
  stub.document.body.append(mountEl);
  const view = mountBoardView({
    host: {
      graph: "Svy",
      blockPageUid: () => "pageLAB99",
      renderString(el, string) { el.textContent = string; },
      renderBlock() {},
      unmount() {},
    },
    session,
    mountEl,
    settings: { get: (k) => (k === "motion" ? motion : undefined) },
    version: "1.3.0",
  });
  stub.flushFrames();
  return { stub, restore, view };
}

function snapshot(root) {
  return {
    motion: root.dataset.motion,
    off: root.classList.contains("pxd-root--motion-off"),
    reduced: root.classList.contains("pxd-root--motion-reduced"),
    none: root.classList.contains("pxd-root--motion-none"),
    zoom: root.style["--pxd-zoom-ms"],
    present: root.style["--pxd-present-ms"],
    pulse: root.style["--pxd-pulse-ms"],
  };
}

test("UI-6: resolveMotion honors each value and prefers-reduced-motion", () => {
  assert.equal(resolveMotion("full", false), "full");
  assert.equal(resolveMotion("reduced", false), "reduced");
  assert.equal(resolveMotion("none", false), "none");
  assert.equal(resolveMotion("full", true), "reduced");
  assert.equal(resolveMotion("reduced", true), "reduced");
  assert.equal(resolveMotion("none", true), "none");
  assert.equal(resolveMotion("bogus", false), "full");
  assert.equal(resolveMotion(undefined, true), "reduced");
  assert.equal(normalizeSetting("motion", "none"), "none");
  assert.equal(normalizeSetting("motion", "reduced"), "reduced");
  assert.equal(normalizeSetting("motion", "nope"), "full");
  const row = createSettingsPanel().settings.find((r) => r.id === "motion");
  assert.equal(row.action.type, "select");
  assert.deepEqual(row.action.items, ["full", "reduced", "none"]);
  assert.deepEqual(
    ["full", "reduced", "none"].map((level) => MOTION_PROFILE[level].zoomMs),
    [180, 70, 0],
  );
});

test("UI-6: each motion value sets zoom, present, edges, and pulses", () => {
  const f = mount(undefined);
  try {
    const root = f.view.root;
    const world = root.querySelector(".pxd-world");
    const zoomBtn = root.querySelector(".pxd-toolbar__zoom-in");
    const shell = () => root.querySelector("[data-uid=cardAAAA1]");
    const expectLevel = (level) => {
      const snap = snapshot(root);
      const profile = MOTION_PROFILE[level];
      assert.equal(snap.motion, level);
      assert.equal(snap.off, level !== "full");
      assert.equal(snap.reduced, level === "reduced");
      assert.equal(snap.none, level === "none");
      assert.equal(snap.zoom, `${profile.zoomMs}ms`);
      assert.equal(snap.present, `${profile.presentMs}ms`);
      assert.equal(snap.pulse, `${profile.pulseMs}ms`);
    };

    expectLevel("full");
    const before = world.style.transform;
    f.stub.dispatch(zoomBtn, "click", {});
    assert.equal(root.classList.contains("pxd-root--zooming"), true);
    f.stub.flushFrames();
    assert.notEqual(world.style.transform, before);
    f.stub.dispatch(world, "wheel", { deltaX: 12, deltaY: 0 });
    assert.equal(root.classList.contains("pxd-root--zooming"), false, "a pan clears the zoom transition");

    root.querySelector(".pxd-toolbar__present").click();
    const hud = root.querySelector(".pxd-present-hud");
    assert.equal(f.view.state().present, true);
    assert.ok(hud.classList.contains("pxd-present-hud--step"));
    assert.equal(root.classList.contains("pxd-root--zooming"), true);
    hud.querySelector(".pxd-present-hud__exit").click();
    assert.equal(f.view.state().present, false);

    f.stub.window.location.hash = cardDeepLink({ graph: "Svy", pageUid: "pageLAB99", cardUid: "cardAAAA1" });
    f.stub.dispatch(f.stub.window, "hashchange", {});
    f.stub.flushFrames();
    assert.equal(shell().classList.contains("pxd-item--pulse"), true);

    f.view.setSettings({ get: (k) => (k === "motion" ? "reduced" : undefined) });
    expectLevel("reduced");
    f.stub.dispatch(zoomBtn, "click", {});
    assert.equal(root.classList.contains("pxd-root--zooming"), true);
    root.querySelector(".pxd-toolbar__present").click();
    assert.ok(root.querySelector(".pxd-present-hud").classList.contains("pxd-present-hud--step"));
    assert.equal(root.style["--pxd-present-ms"], "60ms");
    assert.equal(root.classList.contains("pxd-root--zooming"), true);
    root.querySelector(".pxd-present-hud__exit").click();
    shell().classList.remove("pxd-item--pulse");
    f.stub.dispatch(f.stub.window, "hashchange", {});
    f.stub.flushFrames();
    assert.equal(shell().classList.contains("pxd-item--pulse"), true);

    f.view.setSettings({ get: (k) => (k === "motion" ? "none" : undefined) });
    expectLevel("none");
    const snapped = world.style.transform;
    f.stub.dispatch(zoomBtn, "click", {});
    assert.equal(root.classList.contains("pxd-root--zooming"), false);
    f.stub.flushFrames();
    assert.notEqual(world.style.transform, snapped);
    root.querySelector(".pxd-toolbar__present").click();
    assert.ok(root.querySelector(".pxd-present-hud").classList.contains("pxd-present-hud--step"));
    assert.equal(root.classList.contains("pxd-root--zooming"), false);
    root.querySelector(".pxd-present-hud__exit").click();
    shell().classList.remove("pxd-item--pulse");
    f.stub.dispatch(f.stub.window, "hashchange", {});
    f.stub.flushFrames();
    assert.equal(shell().classList.contains("pxd-item--pulse"), false);
  } finally {
    f.view.dispose();
    f.restore();
  }
});

test("UI-6: prefers-reduced-motion shortens full and leaves none alone", () => {
  const holder = { fn: null, set(fn) { this.fn = fn; } };
  let reduced = false;
  const stub = createDomStub();
  const restore = stub.install();
  stub.window.matchMedia = (query) => ({
    get matches() { return String(query).includes("prefers-reduced-motion") ? reduced : false; },
    media: String(query),
    addEventListener(type, fn) {
      if (String(query).includes("prefers-reduced-motion") && type === "change") holder.set(fn);
    },
    removeEventListener() {},
  });
  const board = buildBoard(pull([card]));
  const view = mountBoardView({
    host: { graph: "Svy", renderString(el, string) { el.textContent = string; }, renderBlock() {}, unmount() {} },
    session: sessionFor(board),
    mountEl: stub.document.body.appendChild(stub.document.createElement("div")),
    settings: { get: () => undefined },
    version: "1.3.0",
  });
  try {
    stub.flushFrames();
    assert.equal(view.root.dataset.motion, "full");
    reduced = true;
    holder.fn();
    assert.equal(view.root.dataset.motion, "reduced");
    assert.equal(view.root.classList.contains("pxd-root--motion-off"), true);
    view.setSettings({ get: (k) => (k === "motion" ? "none" : undefined) });
    assert.equal(view.root.dataset.motion, "none");
    assert.equal(view.root.style["--pxd-zoom-ms"], "0ms");
  } finally {
    view.dispose();
    restore();
  }
});

test("UI-6: css gates zoom, present, pulses, and animated edges", () => {
  const ext = readFileSync(new URL("../src/extension.css", import.meta.url), "utf8");
  const overlays = readFileSync(new URL("../src/css/overlays.css", import.meta.url), "utf8");
  const props = readFileSync(new URL("../src/css/props.css", import.meta.url), "utf8");
  assert.match(ext, /\.pxd-root\.pxd-root--zooming \.pxd-world \{[^}]*transition: transform var\(--pxd-zoom-ms, 180ms\)/);
  assert.match(ext, /\.pxd-root\.pxd-root--motion-none \.pxd-world \{[^}]*transition: none/);
  assert.match(ext, /\.pxd-root\.pxd-root--motion-reduced \.pxd-item--pulse \{[^}]*animation-duration: 0\.4s/);
  assert.match(ext, /\.pxd-root\.pxd-root--motion-none \.pxd-item--pulse \{[^}]*animation: none/);
  assert.match(ext, /@media \(prefers-reduced-motion: reduce\) \{[^}]*\.pxd-item--pulse/);
  assert.match(overlays, /@keyframes pxd-present-in/);
  assert.match(overlays, /\.pxd-present-hud--step \{[^}]*animation: pxd-present-in var\(--pxd-present-ms, 160ms\)/);
  assert.match(overlays, /\.pxd-root--motion-none \.pxd-present-hud \{[^}]*animation: none/);
  assert.match(overlays, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(props, /@media \(prefers-reduced-motion: reduce\) \{[^}]*\.pxd-edge--animated \.pxd-edge__line \{[^}]*animation: none/);
  assert.match(props, /\.pxd-root\.pxd-root--motion-off \.pxd-edge--animated \.pxd-edge__line \{[^}]*animation: none/);
});
