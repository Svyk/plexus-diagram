// REG-5: target, show stash, and the delayed hover popover.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { placePopover } from "../src/relchips.js";
import { createShowStash, openHoverPopover, pickCameraMount, resolveRegionTarget } from "../src/view/region-open.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const ANCHOR = { left: 40, top: 40, right: 80, bottom: 70, width: 40, height: 30, x: 40, y: 40 };
const POP = { left: 0, top: 0, width: 120, height: 80, right: 120, bottom: 80, x: 0, y: 0 };

function expectedAt(anchor, obstacles) {
  const r = anchor.getBoundingClientRect();
  const spec = {
    anchor: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
    size: { w: POP.width, h: POP.height },
    viewport: { left: 0, top: 0, right: 800, bottom: 600 },
  };
  if (obstacles !== undefined) spec.obstacles = obstacles;
  return placePopover(spec);
}

function setup({ obstacles, delayMs = 350, timers } = {}) {
  const stub = createDomStub({ width: 800, height: 600 });
  const restore = stub.install();
  const anchor = stub.document.createElement("div");
  anchor._rect = { ...ANCHOR };
  stub.document.body.append(anchor);
  let built = 0;
  const handle = openHoverPopover({
    doc: stub.document,
    win: stub.window,
    anchor,
    delayMs,
    obstacles,
    timers,
    build(el) {
      built += 1;
      el._rect = { ...POP };
    },
  });
  return {
    stub,
    anchor,
    handle,
    built: () => built,
    restore,
    show() { stub.flushTimers(); },
  };
}

test("REG-5: resolveRegionTarget returns a board hit, otherwise the outline", () => {
  const outline = { blockUid: "imgBlock1", pageUid: "page1" };
  assert.deepEqual(
    resolveRegionTarget({ boardUid: "board1", pageUid: "pageB", cardUid: "card1", extra: true }, outline),
    { kind: "board", boardUid: "board1", pageUid: "pageB", cardUid: "card1" },
  );
  assert.deepEqual(resolveRegionTarget(null, outline), { kind: "outline", blockUid: "imgBlock1", pageUid: "page1" });
  assert.deepEqual(
    resolveRegionTarget({ boardUid: "board1", pageUid: "pageB" }, outline),
    { kind: "outline", blockUid: "imgBlock1", pageUid: "page1" },
  );
});

test("REG-5: the show stash keeps eight seconds and a second empty peek does not clear it", () => {
  const clock = { t: 10_000 };
  const bag = createShowStash(() => clock.t);
  bag.stash({ uid: "imgBlock1", until: clock.t + 8000 });
  const first = bag.peek();
  assert.deepEqual(first, { uid: "imgBlock1", until: clock.t + 8000 });
  assert.ok(first.until - clock.t >= 8000);
  const second = bag.peek();
  assert.equal(second, first, "a second peek with no uid returns the live entry");
  bag.stash({ until: clock.t + 8000 });
  assert.equal(bag.peek(), first, "a stash call with no uid does not clear");
  assert.equal(bag.peek("other"), null);
  assert.equal(bag.peek().uid, "imgBlock1");

  bag.stash({ uid: "short", until: clock.t + 1000 });
  assert.ok(bag.peek().until - clock.t >= 8000);

  const live = bag.peek();
  clock.t = live.until;
  assert.equal(bag.peek(), live);
  clock.t = live.until + 1;
  assert.equal(bag.peek(), null);

  clock.t = 20_000;
  bag.stash({ uid: "again", until: clock.t + 8000 });
  bag.clear();
  assert.equal(bag.peek(), null);
});

test("REG-5: the popover is absent before the delay and placed after it", () => {
  const ctx = setup();
  try {
    assert.equal(ctx.built(), 0);
    assert.equal(ctx.handle.el.isConnected, false);
    assert.equal(ctx.stub.document.querySelector(".pxd-region-pop"), null);
    assert.equal(ctx.handle.el.style.position, "fixed");
    assert.equal([...ctx.stub.timers][0].ms, 350);

    ctx.show();
    assert.equal(ctx.built(), 1);
    assert.equal(ctx.handle.el.isConnected, true);
    assert.equal(ctx.stub.document.querySelector(".pxd-region-pop"), ctx.handle.el);
    assert.equal(ctx.handle.el.classList.contains("pxd-root"), true);
    assert.equal(ctx.handle.el.classList.contains("pxd-region-pop"), true);

    const at = expectedAt(ctx.anchor);
    assert.equal(ctx.handle.el.style.left, `${at.left}px`);
    assert.equal(ctx.handle.el.style.top, `${at.top}px`);

    for (const type of ["pointerdown", "mousedown", "mouseup", "dblclick"]) {
      const event = ctx.stub.dispatch(ctx.handle.el, type);
      assert.equal(event.propagationStopped, true, type);
      assert.equal(ctx.handle.el.isConnected, true, type);
    }

    ctx.anchor._rect = { left: 40, top: 200, right: 80, bottom: 230, width: 40, height: 30, x: 40, y: 200 };
    ctx.stub.dispatch(ctx.stub.window, "scroll");
    const scrolled = expectedAt(ctx.anchor);
    assert.equal(ctx.handle.el.style.top, `${scrolled.top}px`);
    assert.notEqual(scrolled.top, at.top);

    ctx.anchor._rect = { left: 300, top: 40, right: 360, bottom: 70, width: 60, height: 30, x: 300, y: 40 };
    ctx.stub.dispatch(ctx.stub.window, "resize");
    const resized = expectedAt(ctx.anchor);
    assert.equal(ctx.handle.el.style.left, `${resized.left}px`);

    const outside = ctx.stub.document.createElement("div");
    ctx.stub.document.body.append(outside);
    ctx.stub.dispatch(outside, "pointerdown");
    assert.equal(ctx.handle.el.isConnected, false);
  } finally {
    ctx.handle.close();
    ctx.restore();
  }
});

test("REG-5: Escape closes, a disconnected anchor closes, and obstacles are forwarded", () => {
  const esc = setup();
  try {
    esc.show();
    esc.stub.dispatch(esc.stub.document.body, "keydown", { key: "Enter" });
    assert.equal(esc.handle.el.isConnected, true);
    esc.stub.dispatch(esc.stub.document.body, "keydown", { key: "Escape" });
    assert.equal(esc.handle.el.isConnected, false);
  } finally {
    esc.handle.close();
    esc.restore();
  }

  const gone = setup();
  try {
    gone.anchor.remove();
    gone.show();
    assert.equal(gone.built(), 0);
    assert.equal(gone.stub.document.querySelector(".pxd-region-pop"), null);
  } finally {
    gone.handle.close();
    gone.restore();
  }

  const drop = setup();
  try {
    drop.show();
    drop.anchor.remove();
    drop.stub.dispatch(drop.stub.window, "resize");
    assert.equal(drop.handle.el.isConnected, false);
  } finally {
    drop.handle.close();
    drop.restore();
  }

  const wall = [{ left: 0, top: 60, right: 800, bottom: 400 }];
  const blocked = setup({ obstacles: wall });
  try {
    blocked.show();
    const plain = expectedAt(blocked.anchor);
    const at = expectedAt(blocked.anchor, wall);
    assert.notEqual(at.top, plain.top);
    assert.equal(blocked.handle.el.style.left, `${at.left}px`);
    assert.equal(blocked.handle.el.style.top, `${at.top}px`);
  } finally {
    blocked.handle.close();
    blocked.restore();
  }
});

test("REG-5: close before the delay cancels the popover, and timers.later is the clock", () => {
  const early = setup();
  try {
    early.handle.close();
    early.show();
    assert.equal(early.built(), 0);
    assert.equal(early.stub.document.querySelector(".pxd-region-pop"), null);
  } finally {
    early.restore();
  }

  const stub = createDomStub({ width: 800, height: 600 });
  const restore = stub.install();
  try {
    const anchor = stub.document.createElement("div");
    anchor._rect = { ...ANCHOR };
    stub.document.body.append(anchor);
    let pending = null;
    let cancelled = false;
    const handle = openHoverPopover({
      doc: stub.document,
      win: stub.window,
      anchor,
      delayMs: 350,
      timers: {
        later(fn, ms) {
          pending = { fn, ms };
          return () => { cancelled = true; };
        },
      },
      build(el) { el._rect = { ...POP }; },
    });
    assert.equal(stub.timers.size, 0);
    assert.equal(pending.ms, 350);
    assert.equal(handle.el.isConnected, false);
    const show = pending.fn;
    handle.close();
    assert.equal(cancelled, true);
    show();
    assert.equal(handle.el.isConnected, false);

    cancelled = false;
    pending = null;
    const anchor2 = stub.document.createElement("div");
    anchor2._rect = { ...ANCHOR };
    stub.document.body.append(anchor2);
    const opened = openHoverPopover({
      doc: stub.document,
      win: stub.window,
      anchor: anchor2,
      delayMs: 350,
      timers: {
        later(fn, ms) {
          pending = { fn, ms };
          return () => { cancelled = true; };
        },
      },
      build(el) { el._rect = { ...POP }; },
    });
    assert.equal(opened.el.isConnected, false);
    pending.fn();
    assert.equal(opened.el.isConnected, true);
    opened.close();
    assert.equal(opened.el.isConnected, false);
  } finally {
    restore();
  }
});

test("REG-5: cameraRect(uid) reads the sidebar mount and a bare read stays on main", () => {
  const main = { uid: "board", current: "board", view: { name: "main" }, side: false };
  const dormant = { uid: "board", current: "board", view: null, side: false };
  const side = { uid: "board", current: "board", view: { name: "side" }, side: true };
  const isSide = (row) => row.side;
  const current = (row) => row.current;
  assert.equal(pickCameraMount([dormant, side], "board", isSide, current), side);
  assert.equal(pickCameraMount([side, main], "", isSide, current), main);
  assert.equal(pickCameraMount([side], "board", isSide, current), side);
  assert.equal(pickCameraMount([main], "board", isSide, current), main);
});

test("REG-5: hover CSS uses a 1px border and no box-shadow", () => {
  const css = readFileSync(new URL("../src/css/region-hover.css", import.meta.url), "utf8");
  assert.match(css, /\.pxd-root\.pxd-region-pop\s*\{[^}]*position:\s*fixed;/s);
  assert.match(css, /\.pxd-root\.pxd-region-pop\s*\{[^}]*flex-direction:\s*column;/s);
  assert.match(css, /\.pxd-root\.pxd-region-pop\s*\{[^}]*border:\s*1px solid/s);
  assert.match(css, /\.pxd-root\.pxd-region-pop\s*\{[^}]*box-shadow:\s*none;/s);
  const shadows = css.match(/box-shadow\s*:[^;]+/g);
  assert.ok(shadows?.length);
  for (const line of shadows) assert.match(line, /box-shadow\s*:\s*none\s*$/);
  assert.doesNotMatch(css, /accent-soft/);
});
