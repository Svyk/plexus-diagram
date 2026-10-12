import assert from "node:assert/strict";
import test from "node:test";
import { applyFullscreenChrome } from "../src/view/fullscreen.js";

function fakeRoot(reads) {
  const rectOf = (r) => ({ getBoundingClientRect() { reads.push(r.name); return r.rect; } });
  const topbar = rectOf({ name: "topbar", rect: { bottom: 48 } });
  const article = rectOf({ name: "article", rect: { top: 50, left: 240, right: 1000, bottom: 700 } });
  const classes = new Set();
  return {
    body: { classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) } },
    defaultView: { innerWidth: 1000, innerHeight: 700 },
    querySelector: (sel) => (sel === ".rm-topbar" ? topbar : sel === ".rm-article-wrapper" ? article : null),
    querySelectorAll: () => [],
  };
}

test("POL-5: entering fullscreen reads no layout while the board mounts when a ResizeObserver will place it", () => {
  const reads = [];
  const root = fakeRoot(reads);
  const observers = [];
  const prevRO = globalThis.ResizeObserver;
  const prevRaf = globalThis.requestAnimationFrame;
  globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb; observers.push(this); } observe() {} disconnect() {} };
  globalThis.requestAnimationFrame = () => 0;
  try {
    const mount = { classList: { toggle() {} }, style: {} };
    const stop = applyFullscreenChrome(mount, true, root);
    assert.deepEqual(reads, []);
    assert.equal(mount.style.top, undefined);
    observers[0].cb();
    assert.ok(reads.includes("topbar"));
    assert.equal(mount.style.top, "50px");
    assert.equal(mount.style.left, "240px");
    stop();
  } finally {
    globalThis.ResizeObserver = prevRO;
    globalThis.requestAnimationFrame = prevRaf;
  }
});

test("POL-5: without a ResizeObserver fullscreen still places at once", () => {
  const reads = [];
  const root = fakeRoot(reads);
  const prevRO = globalThis.ResizeObserver;
  globalThis.ResizeObserver = undefined;
  try {
    const mount = { classList: { toggle() {} }, style: {} };
    applyFullscreenChrome(mount, true, root)();
    assert.equal(mount.style.top, "50px");
  } finally {
    globalThis.ResizeObserver = prevRO;
  }
});

test("fullscreen follows the article's border box, so a docked panel closing (padding only) widens the board again", () => {
  const root = fakeRoot([]);
  const seen = [];
  const prevRO = globalThis.ResizeObserver;
  const prevRaf = globalThis.requestAnimationFrame;
  globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb; } observe(el, opts) { seen.push(opts); } disconnect() {} };
  globalThis.requestAnimationFrame = () => 0;
  try {
    const stop = applyFullscreenChrome({ classList: { toggle() {} }, style: {} }, true, root);
    assert.deepEqual(seen[0], { box: "border-box" });
    stop();
  } finally {
    globalThis.ResizeObserver = prevRO;
    globalThis.requestAnimationFrame = prevRaf;
  }
});
