// UX4 lane C: C2 (the Roam outline under a fullscreen board) and C3 (zoom cost on the big board).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mountBig, settledIn } from "./fixtures/big-mount.js";
import { applyFullscreenChrome, FS_COVER_CLASS, holdFsCover } from "../src/view/fullscreen.js";

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
  assert.equal(rule(`body.${FS_COVER_CLASS} .roam-article .pxd-mount,\nbody.${FS_COVER_CLASS} .roam-article .pxd-mount--fullscreen`), "visible");
  for (const line of css.split("\n")) if (line.includes(FS_COVER_CLASS)) assert.ok(!line.includes(":has("), line);
});

test("C2: a held cover outlives the fullscreen chrome until the hold is dropped; a new fullscreen board takes it over", async () => {
  const m = mountBig({ x: 0, y: 0, zoom: 0.3 }, { fullscreen: true });
  const doc = m.stub.document;
  const body = doc.body;
  try {
    await settledIn(m);
    assert.ok(body.classList.contains(FS_COVER_CLASS));
    holdFsCover(doc, true);
    applyFullscreenChrome(m.mountEl, false, doc);
    assert.ok(!body.classList.contains("pxd-has-fullscreen"));
    assert.ok(body.classList.contains(FS_COVER_CLASS), "held through the remount gap");
    applyFullscreenChrome(m.mountEl, true, doc);
    holdFsCover(doc, false);
    assert.ok(body.classList.contains(FS_COVER_CLASS), "a fullscreen board is back: the cover stays");
    applyFullscreenChrome(m.mountEl, false, doc);
    assert.ok(!body.classList.contains(FS_COVER_CLASS), "its hold was taken over, so leaving fullscreen drops it");
    applyFullscreenChrome(m.mountEl, true, doc);
    holdFsCover(doc, true);
    applyFullscreenChrome(m.mountEl, false, doc);
    holdFsCover(doc, false);
    assert.ok(!body.classList.contains(FS_COVER_CLASS), "a dropped hold with no fullscreen board uncovers");
  } finally { m.done(); }
});

test("C2: fsCover off adds no cover (3.36.0)", async () => {
  const m = mountBig({ x: 0, y: 0, zoom: 0.3 }, { fullscreen: true, flags: { fsCover: false } });
  try {
    await settledIn(m);
    assert.ok(m.stub.document.body.classList.contains("pxd-has-fullscreen"));
    assert.ok(!m.stub.document.body.classList.contains(FS_COVER_CLASS));
  } finally { m.done(); }
});

// C3 zoomHeads: a settle on a new zoom step resizes the heads in place; the full re-place gives the same heads.
async function zoomOutHeads(flags) {
  const m = mountBig({ x: -400, y: -300, zoom: 0.5 }, { flags, fullscreen: true });
  try {
    await settledIn(m);
    // Line paths of the edges already on the board: a full re-place writes each of them again.
    let rewrites = 0;
    const lines = [...m.view.root.querySelectorAll(".pxd-edge__line")];
    for (const line of lines) {
      const set = line.setAttribute.bind(line);
      line.setAttribute = (name, value) => { if (name === "d") rewrites += 1; return set(name, value); };
    }
    for (let i = 0; i < 3; i += 1) { m.stub.dispatch(m.view.root, "wheel", { deltaX: 0, deltaY: 60, ctrlKey: true, deltaMode: 0, clientX: 700, clientY: 450 }); m.stub.flushFrames(); }
    for (let i = 0; i < 30; i += 1) { await tick(30); m.stub.flushTimers(); m.stub.flushFrames(); m.stub.flushIdle(); }
    await m.pump(40);
    const heads = new Map();
    for (const g of m.view.root.querySelectorAll(".pxd-edge")) heads.set(g.getAttribute("data-uid") || g.dataset?.uid, g.querySelector(".pxd-edge__head")?.getAttribute("d"));
    return { zoom: m.view.viewport().zoom, attached: lines.length, placed: rewrites, heads, audit: m.view.paintAudit() };
  } finally { m.done(); }
}

test("C3 zoomHeads: a zoom-out settle on a new zoom step re-sizes the arrow heads without re-placing every edge; heads match the full re-place", async () => {
  const on = await zoomOutHeads({});
  const off = await zoomOutHeads({ zoomHeads: false });
  assert.equal(on.zoom, off.zoom);
  assert.ok(on.attached > 300, `attached before the zoom: ${on.attached}`);
  assert.ok(off.placed >= on.attached * 0.9, `full re-place: ${off.placed} of ${off.attached}`);
  assert.ok(on.placed < on.attached / 10, `on ${on.placed} vs off ${off.placed} (attached ${on.attached})`);
  let compared = 0;
  for (const [uid, d] of on.heads) {
    if (!off.heads.has(uid)) continue;
    assert.equal(d, off.heads.get(uid), uid);
    compared += 1;
  }
  assert.ok(compared > 200, `compared ${compared}`);
  assert.equal(on.audit.missing, 0);
});

// C3 zoomHeads, zoom-in: the far edges a detail settle will park are not resized first.
async function zoomInHeads(flags) {
  const m = mountBig({ x: 300, y: 20, zoom: 0.1 }, { flags, fullscreen: true });
  try {
    await settledIn(m);
    let headWrites = 0;
    const heads = [...m.view.root.querySelectorAll(".pxd-edge__head")];
    for (const head of heads) {
      const set = head.setAttribute.bind(head);
      head.setAttribute = (name, value) => { if (name === "d") headWrites += 1; return set(name, value); };
    }
    for (let i = 0; i < 12; i += 1) { m.stub.dispatch(m.view.root, "wheel", { deltaX: 0, deltaY: -60, ctrlKey: true, deltaMode: 0, clientX: 700, clientY: 450 }); m.stub.flushFrames(); }
    for (let i = 0; i < 30; i += 1) { await tick(30); m.stub.flushTimers(); m.stub.flushFrames(); m.stub.flushIdle(); }
    await m.pump(60);
    const shown = new Map();
    for (const g of m.view.root.querySelectorAll(".pxd-edge")) shown.set(g.getAttribute("data-uid") || g.dataset?.uid, g.querySelector(".pxd-edge__head")?.getAttribute("d"));
    return { zoom: m.view.viewport().zoom, attached: heads.length, headWrites, shown, audit: m.view.paintAudit() };
  } finally { m.done(); }
}

test("C3 zoomHeads: a zoom-in keeps the sliced full re-place; its heads match zoomHeads off and nothing is missing", async () => {
  const on = await zoomInHeads({});
  const off = await zoomInHeads({ zoomHeads: false });
  assert.equal(on.zoom, off.zoom);
  assert.ok(on.attached > 1000, `attached at overview: ${on.attached}`);
  assert.equal(on.headWrites, off.headWrites, "zoom-in is the 3.36.0 path");
  let compared = 0;
  for (const [uid, d] of on.shown) {
    if (!off.shown.has(uid)) continue;
    assert.equal(d, off.shown.get(uid), uid);
    compared += 1;
  }
  assert.ok(compared > 20, `compared ${compared}`);
  assert.equal(on.audit.missing, 0);
});
