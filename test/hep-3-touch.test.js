import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildBoard, worldRects } from "../src/model/board.js";
import { pinchViewport } from "../src/model/touch.js";
import { createInteractions } from "../src/view/interactions.js";
import { mountBoardView } from "../src/view/board-view.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function pulled() {
  return {
    ":block/uid": "board0001",
    ":block/string": "{{[[diagram]]:Touch}}",
    ":block/props": { ":plexus": { ":v": 2 } },
    ":block/children": [
      {
        ":block/uid": "cardAAAA1",
        ":block/string": "Alpha",
        ":block/order": 0,
        ":block/props": { ":plexus": { ":x": 0, ":y": 0, ":w": 200, ":h": 100 } },
        ":block/children": [],
      },
    ],
  };
}

function harness() {
  const board = buildBoard(pulled());
  const rects = worldRects(board);
  const card = { ...rects.get("cardAAAA1") };
  let vp = { x: 0, y: 0, zoom: 1 };
  const calls = [];
  const ctl = createInteractions({
    actions: {
      board: () => board,
      rects: () => rects,
      viewport: () => vp,
      size: () => ({ width: 800, height: 600 }),
      setViewport: (next) => { vp = next; calls.push(["setViewport", next]); },
      commitMove: (...args) => { calls.push(["commitMove", ...args]); },
      previewMove: (...args) => { calls.push(["previewMove", ...args]); },
      onSelection: () => {},
      onTool: () => {},
      onHover: () => {},
      setGesturing: () => {},
      showMarquee: () => {},
      showLasso: () => {},
      showGuides: () => {},
      cancelPreview: () => {},
      showGhosts: () => {},
    },
    settings: { get: () => undefined },
  });
  const down = (pointerId, screen) => ctl.handle({
    type: "pointerdown",
    pointerId,
    button: 0,
    screen,
    world: { x: screen.x - vp.x, y: screen.y - vp.y },
    target: { kind: "empty" },
    shift: false,
    alt: false,
    meta: false,
    ctrl: false,
  });
  const move = (pointerId, screen) => ctl.handle({
    type: "pointermove",
    pointerId,
    button: 0,
    screen,
    world: { x: (screen.x - vp.x) / vp.zoom, y: (screen.y - vp.y) / vp.zoom },
    target: { kind: "empty" },
    shift: false,
    alt: false,
    meta: false,
    ctrl: false,
  });
  const up = (pointerId, screen) => ctl.handle({
    type: "pointerup",
    pointerId,
    button: 0,
    screen,
    world: screen,
    target: { kind: "empty" },
  });
  return { ctl, calls, card, rects, down, move, up, vp: () => vp };
}

test("HEP-3: a two-finger pinch from zoom 1 lands near zoom 2 around the midpoint", () => {
  const h = harness();
  h.down(1, { x: 80, y: 80 });
  h.down(2, { x: 120, y: 80 });
  h.move(1, { x: 60, y: 80 });
  h.move(2, { x: 140, y: 80 });
  const vp = h.vp();
  assert.ok(Math.abs(vp.zoom - 2) < 0.15, `zoom ${vp.zoom}`);
  const screenX = vp.x + 100 * vp.zoom;
  const screenY = vp.y + 80 * vp.zoom;
  assert.ok(Math.hypot(screenX - 100, screenY - 80) < 24, `mid ${screenX},${screenY}`);
  assert.equal(h.calls.some((c) => c[0] === "commitMove"), false);
  assert.deepEqual(h.rects.get("cardAAAA1"), h.card);
  h.up(1, { x: 60, y: 80 });
  h.up(2, { x: 140, y: 80 });
  assert.equal(h.calls.some((c) => c[0] === "commitMove"), false);
});

test("HEP-3: a two-finger pan moves the camera by the finger delta and not the card", () => {
  const h = harness();
  h.down(1, { x: 80, y: 80 });
  h.down(2, { x: 120, y: 80 });
  h.move(1, { x: 110, y: 70 });
  h.move(2, { x: 150, y: 70 });
  const vp = h.vp();
  const expected = pinchViewport({ x: 0, y: 0, zoom: 1 }, {
    dist0: 40,
    mid0: { x: 100, y: 80 },
    dist: 40,
    mid: { x: 130, y: 70 },
  });
  assert.ok(Math.abs(vp.x - expected.x) < 8, `x ${vp.x}`);
  assert.ok(Math.abs(vp.y - expected.y) < 8, `y ${vp.y}`);
  assert.equal(vp.zoom, 1);
  assert.equal(h.calls.some((c) => c[0] === "commitMove"), false);
  assert.deepEqual(h.rects.get("cardAAAA1"), h.card);
});

function mountTouch() {
  const stub = createDomStub();
  const restore = stub.install();
  const board = buildBoard(pulled());
  const wrote = [];
  const session = {
    uid: board.uid,
    board,
    rects: worldRects(board),
    links: [],
    coveredEdges: new Set(),
    on() { return () => {}; },
    release() {},
    commitMove(...args) { wrote.push(["commitMove", ...args]); },
    setString(...args) { wrote.push(["setString", ...args]); },
  };
  const mountEl = stub.document.createElement("div");
  mountEl.className = "pxd-mount";
  stub.document.body.append(mountEl);
  const view = mountBoardView({
    host: {
      graph: "Notes",
      renderString(el, string) { el.textContent = string; },
      renderBlock() {},
      unmount() {},
      stats: { writes: 0 },
    },
    session,
    mountEl,
    settings: { get: () => undefined },
  });
  stub.flushFrames();
  let captures = 0;
  const prev = view.root.setPointerCapture;
  view.root.setPointerCapture = (...args) => { captures += 1; return prev?.(...args); };
  const pointer = (type, extra) => stub.dispatch(type === "pointerdown" ? view.root : stub.document, type, {
    button: 0,
    buttons: 1,
    pointerType: "touch",
    pointerId: 1,
    clientX: 40,
    clientY: 40,
    ...extra,
  });
  return { stub, restore, view, wrote, pointer, captures: () => captures };
}

test("HEP-3: a 500ms touch under 8px opens the board menu", async () => {
  const m = mountTouch();
  m.pointer("pointerdown", { clientX: 40, clientY: 40 });
  m.pointer("pointermove", { clientX: 47, clientY: 40 });
  await sleep(600);
  assert.ok(m.view.root.querySelector(".pxd-menu"), "menu open");
  assert.equal(m.wrote.length, 0);
  assert.equal(m.captures(), 0);
  m.view.dispose();
  m.restore();
});

test("HEP-3: a 20px move cancels the long-press and a mouse hold does not open it", async () => {
  const moved = mountTouch();
  moved.pointer("pointerdown", { clientX: 40, clientY: 40 });
  moved.pointer("pointermove", { clientX: 60, clientY: 40 });
  await sleep(600);
  assert.equal(moved.view.root.querySelector(".pxd-menu"), null);
  assert.equal(moved.wrote.filter((row) => row[0] === "commitMove").length, 0);
  assert.equal(moved.captures(), 0);
  moved.view.dispose();
  moved.restore();

  const mouse = mountTouch();
  mouse.pointer("pointerdown", { pointerType: "mouse", clientX: 40, clientY: 40 });
  await sleep(600);
  assert.equal(mouse.view.root.querySelector(".pxd-menu"), null);
  mouse.view.dispose();
  mouse.restore();
});

test("HEP-3: coarse pointers get a 44px grip and the fine grip stays 8px", () => {
  const css = readFileSync(new URL("../src/extension.css", import.meta.url), "utf8");
  const coarse = css.slice(css.indexOf("@media (pointer: coarse)"));
  assert.ok(coarse.startsWith("@media (pointer: coarse)"));
  assert.match(coarse, /\.pxd-root \.pxd-item\.pxd-item--page\.pxd-item--selected > \.pxd-grip\.pxd-grip--right/);
  // The coarse grip uses the unclamped screen scale: --pxd-inv-zoom is clamped and left a 17.6 px grip at 10% zoom (live).
  assert.match(coarse, /width:\s*calc\(44px \* var\(--pxd-screen-px, var\(--pxd-inv-zoom, 1\)\)\)/);
  assert.match(css, /\.pxd-grip--right \{[^}]*width:\s*calc\(8px \* var\(--pxd-inv-zoom, 1\)\)/);
  const feature = readFileSync(new URL("../src/feature.js", import.meta.url), "utf8");
  assert.match(feature, /settings\[SETTING_IDS\.disableOnMobile\] && isMobile\(extensionAPI\)/);
  assert.match(feature, /extensionAPI\?\.platform\?\.isMobile/);
});
