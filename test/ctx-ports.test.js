import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { avoidSoft } from "../src/model/card-face.js";
import { createChrome } from "../src/view/chrome.js";
import { createDomStub } from "./fixtures/dom-stub.js";

const timers = { later: () => () => {}, frame: () => () => {} };
const PORT_OUT = 6; // .pxd-port is 12 px on screen, centred on the card edge

function setup() {
  const stub = createDomStub();
  const restore = stub.install();
  const root = stub.document.createElement("div");
  root.className = "pxd-root";
  root._rect = { left: 0, top: 0, right: 1200, bottom: 900, width: 1200, height: 900, x: 0, y: 0 };
  stub.document.body.append(root);
  const chrome = createChrome({ doc: stub.document, root, version: "3.9.0", settings: {}, timers, on: {} });
  const ctx = root.querySelector(".pxd-ctx");
  ctx._rect = { left: 0, top: 0, right: 320, bottom: 36, width: 320, height: 36, x: 0, y: 0 };
  return { restore, root, chrome, ctx };
}

const bridgeHeight = async () => {
  const css = await readFile(new URL("../src/css/ctx-toolbar.css", import.meta.url), "utf8");
  const block = css.slice(css.indexOf(".pxd-root .pxd-ctx::before,"));
  return Number(/height:\s*(\d+)px/.exec(block)[1]);
};

const place = (ctx) => ({ left: Number.parseFloat(ctx.style.left), top: Number.parseFloat(ctx.style.top), w: 320, h: 36 });
const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

test("the card hover bar and its bridge stop above the card's top port", async (t) => {
  const f = setup();
  t.after(f.restore);
  const bridge = await bridgeHeight();
  const card = { x: 400, y: 300, w: 240, h: 160 };
  f.chrome.ctx.show("card", { kind: "note" }, () => ({ kind: "items", rect: card }));
  const bar = place(f.ctx);
  const portTop = card.y - PORT_OUT;
  assert.ok(bar.top + bar.h + bridge <= portTop, `bar bottom ${bar.top + bar.h} + bridge ${bridge} must clear the port top ${portTop}`);
  // Flipped below near the top edge: the bridge above the bar stops short of the bottom port.
  const high = { x: 400, y: 20, w: 240, h: 100 };
  f.chrome.ctx.show("card", { kind: "note" }, () => ({ kind: "items", rect: high }));
  const below = place(f.ctx);
  assert.ok(below.top > high.y + high.h, "flipped below");
  assert.ok(below.top - bridge >= high.y + high.h + PORT_OUT, `bridge top ${below.top - bridge} clears the bottom port`);
});

test("the arrow bar steps off a nearby card and its ports", (t) => {
  const f = setup();
  t.after(f.restore);
  const path = { x: 300, y: 400, w: 300, h: 4 };
  const card = { x: 380, y: 280, w: 200, h: 100 };
  f.chrome.ctx.show("edge", { uid: "e1" }, () => ({ kind: "edge", rect: path }));
  const plain = place(f.ctx);
  const zone = { left: card.x - PORT_OUT, top: card.y - PORT_OUT, right: card.x + card.w + PORT_OUT, bottom: card.y + card.h + PORT_OUT };
  assert.ok(overlaps({ ...plain, right: plain.left + plain.w, bottom: plain.top + plain.h }, zone), "without the card list the bar sits on the card");
  f.chrome.ctx.show("edge", { uid: "e1" }, () => ({ kind: "edge", rect: path, cards: [card] }));
  const moved = place(f.ctx);
  assert.ok(!overlaps({ ...moved, right: moved.left + moved.w, bottom: moved.top + moved.h }, zone), `bar ${JSON.stringify(moved)} is off the card`);
  assert.ok(!overlaps({ ...moved, right: moved.left + moved.w, bottom: moved.top + moved.h }, { left: path.x, top: path.y, right: path.x + path.w, bottom: path.y + path.h }), "and off the arrow");
});

test("avoidSoft keeps the bar when it is clear, or when no close spot is free", () => {
  const bar = { left: 100, top: 100, w: 200, h: 30 };
  assert.equal(avoidSoft(bar, [], []), bar);
  assert.equal(avoidSoft(bar, [{ left: 0, top: 300, right: 50, bottom: 400 }], []), bar);
  const wall = [{ left: 0, top: 0, right: 2000, bottom: 2000 }];
  assert.equal(avoidSoft(bar, [{ left: 90, top: 90, right: 150, bottom: 150 }], wall), bar, "hard obstacles win");
  const next = avoidSoft(bar, [{ left: 90, top: 90, right: 150, bottom: 150 }], [], { alts: [{ top: 400 }] });
  assert.notEqual(next, bar);
  assert.ok(!overlaps({ left: next.left, top: next.top, right: next.left + 200, bottom: next.top + 30 }, { left: 90, top: 90, right: 150, bottom: 150 }));
  const tooFar = avoidSoft(bar, [{ left: 0, top: 0, right: 900, bottom: 900 }], [], { reach: 50 });
  assert.equal(tooFar, bar);
});
