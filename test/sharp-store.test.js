import test from "node:test";
import assert from "node:assert/strict";
import { REVOKE_DELAY_MS, createSharpStore } from "../src/view/sharp-store.js";

function rig() {
  const revoked = [];
  const timers = [];
  const store = createSharpStore({
    revoke: (u) => revoked.push(u),
    later: (fn, ms) => { const t = { fn, ms, off: false }; timers.push(t); return () => { t.off = true; }; },
  });
  const flush = () => { for (const t of timers.splice(0)) if (!t.off) t.fn(); };
  return { store, revoked, timers, flush };
}

test("a replaced sharp URL is revoked only after the delay, never at commit", () => {
  const { store, revoked, timers, flush } = rig();
  const a = store.begin("p");
  store.commit("p", a, { src: "blob:a", w: 400 });
  const b = store.begin("p");
  store.commit("p", b, { src: "blob:b", w: 1600 });
  assert.deepEqual(revoked, []);
  assert.equal(timers[0].ms, REVOKE_DELAY_MS);
  assert.equal(store.get("p").src, "blob:b");
  flush();
  assert.deepEqual(revoked, ["blob:a"]);
});

test("out-of-order redraws: the older result never paints and its URL is freed unused", () => {
  const { store, revoked } = rig();
  const t1 = store.begin("p");
  const t2 = store.begin("p");
  assert.equal(store.commit("p", t2, { src: "blob:new", w: 1600 }), true);
  assert.equal(store.commit("p", t1, { src: "blob:old", w: 400 }), false);
  assert.equal(store.get("p").src, "blob:new");
  assert.deepEqual(revoked, ["blob:old"]);
  assert.equal(store.current("p", t1), false);
});

test("interleaved redraws never leave a revoked URL on screen", () => {
  const { store, revoked, flush } = rig();
  const order = [3, 1, 4, 2];
  const tokens = [1, 2, 3, 4].map(() => store.begin("p"));
  for (const i of order) store.commit("p", tokens[i - 1], { src: `blob:z${i}`, w: i * 100 });
  flush();
  assert.equal(store.get("p").src, "blob:z4");
  assert.equal(revoked.includes("blob:z4"), false);
});

test("a failed redraw keeps the last good URL, and with none leaves the stored cover to show", () => {
  const { store, revoked } = rig();
  const a = store.begin("p");
  store.commit("p", a, { src: "blob:a", w: 400, h: 500 });
  const b = store.begin("p");
  store.fail("p", b, 1600);
  assert.equal(store.get("p").src, "blob:a");
  assert.equal(store.get("p").failed, true);
  const c = store.begin("q");
  store.fail("q", c, 800);
  assert.equal(store.get("q").src, "");
  assert.deepEqual(revoked, []);
});

test("dispose revokes live faces and cancels pending revokes", () => {
  const { store, revoked, flush } = rig();
  const a = store.begin("p");
  store.commit("p", a, { src: "blob:a", w: 1 });
  const b = store.begin("p");
  store.commit("p", b, { src: "blob:b", w: 2 });
  store.dispose();
  flush();
  assert.deepEqual(revoked, ["blob:b"]);
});

test("data URLs are never revoked", () => {
  const { store, revoked, flush } = rig();
  const a = store.begin("p");
  store.commit("p", a, { src: "data:image/png;base64,AA", w: 1 });
  const b = store.begin("p");
  store.commit("p", b, { src: "blob:b", w: 2 });
  flush();
  assert.deepEqual(revoked, []);
});
