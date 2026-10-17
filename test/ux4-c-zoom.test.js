// UX4 lane C: C2 (the Roam outline under a fullscreen board) and C3 (zoom cost on the big board).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mountBig, settledIn } from "./fixtures/big-mount.js";
import { FS_COVER_CLASS } from "../src/view/fullscreen.js";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const css = readFileSync(new URL("../src/extension.css", import.meta.url), "utf8");

// Every frame of a Ctrl-wheel burst: root connected, mount fullscreen, body covering the article.
async function zoomFrames(m, dir, ticks) {
  const frames = [];
  const look = () => {
    const body = m.stub.document.body;
    frames.push({
      lod: m.view.root.getAttribute("data-pxd-lod"),
      connected: m.view.root.parentElement === m.mountEl,
      full: m.mountEl.classList.contains("pxd-mount--fullscreen"),
      cover: body.classList.contains(FS_COVER_CLASS),
    });
  };
  look();
  for (let i = 0; i < ticks; i += 1) {
    m.stub.dispatch(m.view.root, "wheel", { deltaX: 0, deltaY: 60 * dir, ctrlKey: true, deltaMode: 0, clientX: 700, clientY: 450 });
    m.stub.flushFrames();
    look();
  }
  for (let i = 0; i < 20; i += 1) { await tick(30); m.stub.flushTimers(); m.stub.flushFrames(); m.stub.flushIdle(); look(); }
  return frames;
}

test("C2: a zoom across both tier flips on the big fullscreen board keeps the root, the fullscreen mount and the article cover on every frame", async () => {
  const m = mountBig({ x: -2000, y: -1500, zoom: 1 }, { fullscreen: true });
  try {
    await settledIn(m);
    const out = await zoomFrames(m, 1, 14);
    const back = await zoomFrames(m, -1, 14);
    const all = [...out, ...back];
    const tiers = new Set(all.map((f) => f.lod));
    assert.ok(tiers.has("detail") && tiers.has("overview"), `crossed both flips: ${[...tiers]}`);
    assert.deepEqual(all.filter((f) => !f.connected || !f.full).length, 0);
    assert.deepEqual(all.filter((f) => !f.cover).length, 0, "the article under the board is covered on every frame");
  } finally { m.done(); }
});

test("C2: the cover rule hides the article and keeps the mounts visible; no :has()", () => {
  const rule = (sel) => new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{[^}]*visibility:\\s*(\\w+)`).exec(css)?.[1];
  assert.equal(rule(`body.${FS_COVER_CLASS} .roam-article`), "hidden");
  assert.equal(rule(`body.${FS_COVER_CLASS} .roam-article .pxd-mount`), "visible");
  for (const line of css.split("\n")) if (line.includes(FS_COVER_CLASS)) assert.ok(!line.includes(":has("), line);
});

test("C2: a fullscreen board disposed on its own zoomed route keeps the cover through the remount gap; a route change drops it", async () => {
  const m = mountBig({ x: 0, y: 0, zoom: 0.3 }, { fullscreen: true });
  const body = m.stub.document.body;
  const win = m.stub.document.defaultView;
  try {
    await settledIn(m);
    assert.ok(body.classList.contains(FS_COVER_CLASS));
    win.location.hash = `#/app/Svy/page/${m.board.uid}`;
    m.view.dispose();
    assert.ok(body.classList.contains(FS_COVER_CLASS), "held for the remount");
    assert.ok(!body.classList.contains("pxd-has-fullscreen"));
    m.stub.flushTimers();
    assert.ok(!body.classList.contains(FS_COVER_CLASS), "dropped when no board came back");
  } finally { m.done(); }
  const n = mountBig({ x: 0, y: 0, zoom: 0.3 }, { fullscreen: true });
  try {
    await settledIn(n);
    const w = n.stub.document.defaultView;
    w.location.hash = "#/app/Svy/page/someOtherPage";
    n.view.dispose();
    assert.ok(!n.stub.document.body.classList.contains(FS_COVER_CLASS), "another route: no hold");
  } finally { n.done(); }
});

test("C2: fsCover off adds no cover (3.36.0)", async () => {
  const m = mountBig({ x: 0, y: 0, zoom: 0.3 }, { fullscreen: true, flags: { fsCover: false } });
  try {
    await settledIn(m);
    assert.ok(m.stub.document.body.classList.contains("pxd-has-fullscreen"));
    assert.ok(!m.stub.document.body.classList.contains(FS_COVER_CLASS));
  } finally { m.done(); }
});
