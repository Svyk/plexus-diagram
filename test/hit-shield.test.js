// P5-A. The hit shield: a fixed layer at the top of the page during a wheel burst or a moved drag, so Chrome's
// per-event and hover hit tests stop at one element instead of walking the Roam page (12-15 ms on the PhD page).
import assert from "node:assert/strict";
import test from "node:test";

import { createHitShield, SHIELD_CLASS } from "../src/view/hit-shield.js";

const fakeEl = (doc, tag) => {
  const listeners = new Map();
  const el = {
    tagName: tag.toUpperCase(), className: "", style: { cssText: "" }, attrs: {}, parentElement: null, children: [],
    setAttribute(k, v) { this.attrs[k] = String(v); },
    addEventListener(type, fn) { listeners.set(type, fn); },
    fire(type, event = {}) { return listeners.get(type)?.({ preventDefault() {}, stopPropagation() {}, ...event }); },
    append(child) { child.parentElement = this; this.children.push(child); },
    remove() { const p = this.parentElement; if (!p) return; p.children = p.children.filter((c) => c !== this); this.parentElement = null; },
    getBoundingClientRect() { return this.rect || { left: 0, top: 0, right: 0, bottom: 0 }; },
  };
  return el;
};
const setup = ({ rect = { left: 100, top: -50, right: 700, bottom: 500 }, pane = { left: 0, top: 40, right: 1000, bottom: 800 }, fullscreen = null } = {}) => {
  const doc = { fullscreenElement: fullscreen, defaultView: null, pressed: [] };
  doc.createElement = (tag) => fakeEl(doc, tag);
  doc.body = fakeEl(doc, "body");
  doc.documentElement = fakeEl(doc, "html");
  const scroller = fakeEl(doc, "div"); scroller.rect = pane; scroller.overflow = "auto"; scroller.parentElement = doc.body;
  const root = fakeEl(doc, "div"); root.rect = rect; root.parentElement = scroller;
  doc.defaultView = { innerWidth: 1200, innerHeight: 900, getComputedStyle: (n) => ({ overflowX: n.overflow || "visible", overflowY: n.overflow || "visible" }) };
  doc.elementFromPoint = () => root;
  const timers = [];
  const later = (fn) => { const t = { fn, live: true }; timers.push(t); return () => { t.live = false; }; };
  return { doc, root, timers, later };
};

test("the shield covers the board's visible rect at the top of the page and goes away on drop", () => {
  const { doc, root, later } = setup();
  const shield = createHitShield({ doc, root, later, onWheel: () => true });
  assert.equal(shield.raise(), true);
  const el = shield.element();
  assert.equal(el.className, SHIELD_CLASS);
  assert.equal(el.attrs["aria-hidden"], "true");
  assert.equal(doc.body.children.includes(el), true);
  // clipped to the scroll pane's top (40), not the root's (-50)
  assert.match(el.style.cssText, /position:fixed;left:100px;top:40px;width:600px;height:460px;z-index:2147483646/);
  assert.equal(shield.raise(), true, "raising again keeps the same layer");
  assert.equal(doc.body.children.length, 1);
  shield.drop();
  assert.equal(shield.isUp(), false);
  assert.equal(doc.body.children.length, 0);
});

test("the kill switch and fullscreen keep the shield down", () => {
  const off = setup();
  assert.equal(createHitShield({ ...off, enabled: () => false }).raise(), false);
  assert.equal(off.doc.body.children.length, 0);
  const fs = setup({ fullscreen: {} });
  assert.equal(createHitShield({ ...fs }).raise(), false);
  const hidden = setup({ rect: { left: 0, top: 900, right: 600, bottom: 1400 } });
  assert.equal(createHitShield({ ...hidden }).raise(), false, "a board scrolled out of the pane gets no shield");
});

test("wheel events on the shield go to the board; one it does not take drops the shield", () => {
  const { doc, root, later } = setup();
  let take = true;
  const seen = [];
  const shield = createHitShield({ doc, root, later, onWheel: (e) => { seen.push(e.deltaY); return take; } });
  shield.raise();
  shield.element().fire("wheel", { deltaY: 30 });
  assert.equal(shield.isUp(), true);
  take = false;
  shield.element().fire("wheel", { deltaY: 40 });
  assert.deepEqual(seen, [30, 40]);
  assert.equal(shield.isUp(), false);
});

test("a pointer move drops the shield, and a press is handed to the element under it", () => {
  const { doc, root, later } = setup();
  const pressed = [];
  const shield = createHitShield({ doc, root, later, onPress: (target, e) => pressed.push([target, e.clientX]) });
  shield.raise();
  shield.element().fire("pointermove");
  assert.equal(shield.isUp(), false);
  shield.raise();
  shield.element().fire("pointerdown", { clientX: 210, clientY: 120 });
  assert.equal(shield.isUp(), false);
  assert.deepEqual(pressed, [[root, 210]]);
});

test("a shield nobody drops goes away on its own", () => {
  const { doc, root, timers, later } = setup();
  const shield = createHitShield({ doc, root, later });
  shield.raise();
  const live = timers.filter((t) => t.live);
  assert.equal(live.length, 1);
  live[0].fn();
  assert.equal(shield.isUp(), false);
});
