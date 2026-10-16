import assert from "node:assert/strict";
import test from "node:test";

import { cameraForCard, revealZoomedBlock } from "../src/model/zoom-open.js";

const size = { width: 800, height: 600 };

test("a readable card that is already centred stays put", () => {
  const vp = { x: 0, y: 0, zoom: 1 };
  const rect = { x: 280, y: 220, w: 240, h: 160 };
  assert.equal(cameraForCard(vp, rect, size), null);
});

test("a card that is too small at 100% zooms to a readable size and stays centred", () => {
  const vp = { x: 0, y: 0, zoom: 1 };
  const rect = { x: 280, y: 284, w: 240, h: 32 };
  const next = cameraForCard(vp, rect, size);
  assert.ok(next);
  assert.equal(next.zoom, 3);
  assert.equal(next.x, 400 - 400 * 3);
  assert.equal(next.y, 300 - 300 * 3);
});

test("a low zoom rises to a readable level and does not zoom back out", () => {
  const vp = { x: 10, y: 10, zoom: 0.3 };
  const rect = { x: 100, y: 80, w: 200, h: 80 };
  const next = cameraForCard(vp, rect, size);
  assert.ok(next.zoom >= 0.5);
  assert.ok(rect.h * next.zoom >= 96);
  const again = cameraForCard(next, rect, size);
  assert.equal(again, null);
});

test("Open on board on another page waits for the folded row, then focuses and centres", async () => {
  let t = 1000;
  let ticks = 0;
  const log = [];
  const ok = await revealZoomedBlock(
    { boardUid: "diagram", cardUid: "card", blockUid: "grandchild" },
    {
      now: () => t,
      budgetMs: 2000,
      tickMs: 50,
      mountedBoard: () => "",
      openBoard: async (uid) => { log.push(["open", uid]); },
      camera: () => ({ x: 0, y: 0, zoom: 1 }),
      cardRect: () => ({ x: 280, y: 284, w: 240, h: 32 }),
      size: () => size,
      applyCamera: (next) => { log.push(["camera", next.zoom]); },
      unfold: (card, block) => { log.push(["unfold", card, block]); },
      rowMounted: () => { ticks += 1; return ticks >= 3; },
      wait: async (ms) => { t += ms; log.push(["wait", ms, t]); },
      focus: (card, block) => { log.push(["focus", card, block]); },
      centre: (card) => { log.push(["centre", card]); },
    },
  );
  assert.equal(ok, true);
  const names = log.map((row) => row[0]);
  assert.deepEqual(names.slice(0, 3), ["open", "camera", "unfold"]);
  assert.equal(log[0][1], "diagram");
  assert.equal(log[1][1], 3);
  const focusAt = names.indexOf("focus");
  assert.ok(focusAt > names.indexOf("wait"));
  assert.equal(names[focusAt + 1], "centre");
  assert.deepEqual(log[focusAt].slice(1), ["card", "grandchild"]);
  assert.equal(log[focusAt + 1][1], "card");
  assert.ok(t <= 1000 + 2000);
});

test("a row that never mounts does not focus, and the wait is bounded", async () => {
  let t = 0;
  const log = [];
  const ok = await revealZoomedBlock(
    { boardUid: "diagram", cardUid: "card", blockUid: "grandchild" },
    {
      now: () => t,
      budgetMs: 200,
      tickMs: 50,
      mountedBoard: () => "diagram",
      openBoard: async () => { log.push("open"); },
      camera: () => ({ x: 0, y: 0, zoom: 1 }),
      cardRect: () => ({ x: 280, y: 220, w: 240, h: 160 }),
      size: () => size,
      applyCamera: () => { log.push("camera"); },
      unfold: () => { log.push("unfold"); },
      rowMounted: () => false,
      wait: async (ms) => { t += ms; log.push("wait"); },
      focus: () => { log.push("focus"); },
      centre: () => { log.push("centre"); },
    },
  );
  assert.equal(ok, false);
  assert.equal(log.includes("open"), false);
  assert.equal(log.includes("focus"), false);
  assert.equal(log.includes("centre"), false);
  assert.ok(log.includes("unfold"));
  assert.ok(log.includes("wait"));
  assert.ok(t <= 200);
});

test("the card block itself does not wait for a child row", async () => {
  const log = [];
  const ok = await revealZoomedBlock(
    { boardUid: "diagram", cardUid: "card", blockUid: "card" },
    {
      now: () => 0,
      mountedBoard: () => "diagram",
      unfold: () => { log.push("unfold"); },
      rowMounted: () => false,
      wait: async () => { log.push("wait"); },
      focus: () => { log.push("focus"); },
      centre: () => { log.push("centre"); },
      camera: () => ({ x: 0, y: 0, zoom: 1 }),
      cardRect: () => ({ x: 280, y: 220, w: 240, h: 160 }),
      size: () => size,
    },
  );
  assert.equal(ok, true);
  assert.deepEqual(log, ["unfold", "focus", "centre"]);
});
